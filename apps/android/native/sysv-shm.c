/*
 * Minimal System V shared memory for PostgreSQL inside an Android app.
 *
 * Android has no SysV IPC. Termux's postgres links libandroid-shmem.so for
 * shmget/shmat/shmdt/shmctl, but that library (a) hard-codes Termux's own
 * /data/data/com.termux/... directory, so it loops forever in any other app,
 * and (b) can deadlock on a stale key marker that points back at its own
 * socket. This file replaces it: built as libandroid-shmem.so with the same
 * exported names, so the unmodified postgres binary uses it.
 *
 * PostgreSQL only needs segments shared between the postmaster and the
 * children it fork()s (no EXEC_BACKEND on Android), so segments are backed by
 * memfd (or ashmem on old kernels) and tracked in a per-process table that
 * children inherit across fork(). A segment from a previous postmaster is
 * never visible to a new process, which is exactly what postgres's
 * "is the old segment still in use?" check wants to hear after a restart.
 */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/ashmem.h>
#include <pthread.h>
#include <stdint.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/ipc.h>
#include <sys/mman.h>
#include <sys/shm.h>
#include <sys/syscall.h>
#include <unistd.h>

#define MAX_SEGMENTS 64
#define MAX_ATTACH 128
#define FIRST_ID 0x4b42 /* arbitrary non-zero base so ids never look like 0/-1 */

struct segment {
    int used;
    int id;
    key_t key;
    size_t size;
    int fd;
    int removed;  /* IPC_RMID requested: free once the last attach is gone */
    int nattch;
    pid_t cpid;
};

struct attachment {
    void *addr;
    size_t size;
    int seg; /* index into segments[] */
};

static struct segment segments[MAX_SEGMENTS];
static struct attachment attachments[MAX_ATTACH];
static int next_id = FIRST_ID;
static pthread_mutex_t lock = PTHREAD_MUTEX_INITIALIZER;

static int create_backing_fd(size_t size)
{
#ifdef __NR_memfd_create
    int fd = (int)syscall(__NR_memfd_create, "pg-sysv-shm", 1 /* MFD_CLOEXEC */);
    if (fd >= 0) {
        if (ftruncate(fd, (off_t)size) == 0) return fd;
        close(fd);
        return -1;
    }
#endif
    /* Kernels without memfd (Android 7-9 on some devices): ashmem. */
    int afd = open("/dev/ashmem", O_RDWR | O_CLOEXEC);
    if (afd < 0) return -1;
    if (ioctl(afd, ASHMEM_SET_NAME, "pg-sysv-shm") < 0 || ioctl(afd, ASHMEM_SET_SIZE, size) < 0) {
        close(afd);
        return -1;
    }
    return afd;
}

static int find_by_id(int shmid)
{
    for (int i = 0; i < MAX_SEGMENTS; i++)
        if (segments[i].used && segments[i].id == shmid) return i;
    return -1;
}

static void maybe_free(int i)
{
    if (segments[i].used && segments[i].removed && segments[i].nattch <= 0) {
        close(segments[i].fd);
        memset(&segments[i], 0, sizeof(segments[i]));
    }
}

int libandroid_shmget(key_t key, size_t size, int flags)
{
    pthread_mutex_lock(&lock);
    if (key != IPC_PRIVATE) {
        for (int i = 0; i < MAX_SEGMENTS; i++) {
            if (segments[i].used && !segments[i].removed && segments[i].key == key) {
                int id = segments[i].id;
                if ((flags & IPC_CREAT) && (flags & IPC_EXCL)) {
                    pthread_mutex_unlock(&lock);
                    errno = EEXIST;
                    return -1;
                }
                if (size > segments[i].size) {
                    pthread_mutex_unlock(&lock);
                    errno = EINVAL;
                    return -1;
                }
                pthread_mutex_unlock(&lock);
                return id;
            }
        }
        if (!(flags & IPC_CREAT)) {
            pthread_mutex_unlock(&lock);
            errno = ENOENT;
            return -1;
        }
    }
    if (size == 0) {
        pthread_mutex_unlock(&lock);
        errno = EINVAL;
        return -1;
    }
    int slot = -1;
    for (int i = 0; i < MAX_SEGMENTS; i++)
        if (!segments[i].used) { slot = i; break; }
    if (slot < 0) {
        pthread_mutex_unlock(&lock);
        errno = ENOSPC;
        return -1;
    }
    int fd = create_backing_fd(size);
    if (fd < 0) {
        pthread_mutex_unlock(&lock);
        errno = ENOMEM;
        return -1;
    }
    segments[slot] = (struct segment){
        .used = 1, .id = next_id++, .key = key, .size = size, .fd = fd, .cpid = getpid(),
    };
    int id = segments[slot].id;
    pthread_mutex_unlock(&lock);
    return id;
}

void *libandroid_shmat(int shmid, const void *shmaddr, int shmflg)
{
    pthread_mutex_lock(&lock);
    int i = find_by_id(shmid);
    if (i < 0) {
        pthread_mutex_unlock(&lock);
        errno = EINVAL;
        return (void *)-1;
    }
    int a = -1;
    for (int k = 0; k < MAX_ATTACH; k++)
        if (!attachments[k].addr) { a = k; break; }
    if (a < 0) {
        pthread_mutex_unlock(&lock);
        errno = EMFILE;
        return (void *)-1;
    }
    int prot = (shmflg & SHM_RDONLY) ? PROT_READ : (PROT_READ | PROT_WRITE);
    int mflags = MAP_SHARED | (shmaddr ? MAP_FIXED : 0);
    void *addr = mmap((void *)shmaddr, segments[i].size, prot, mflags, segments[i].fd, 0);
    if (addr == MAP_FAILED) {
        pthread_mutex_unlock(&lock);
        return (void *)-1;
    }
    attachments[a] = (struct attachment){ .addr = addr, .size = segments[i].size, .seg = i };
    segments[i].nattch++;
    pthread_mutex_unlock(&lock);
    return addr;
}

int libandroid_shmdt(const void *shmaddr)
{
    pthread_mutex_lock(&lock);
    for (int k = 0; k < MAX_ATTACH; k++) {
        if (attachments[k].addr == shmaddr) {
            munmap(attachments[k].addr, attachments[k].size);
            int i = attachments[k].seg;
            attachments[k] = (struct attachment){ 0 };
            segments[i].nattch--;
            maybe_free(i);
            pthread_mutex_unlock(&lock);
            return 0;
        }
    }
    pthread_mutex_unlock(&lock);
    errno = EINVAL;
    return -1;
}

int libandroid_shmctl(int shmid, int cmd, struct shmid_ds *buf)
{
    pthread_mutex_lock(&lock);
    int i = find_by_id(shmid);
    if (i < 0) {
        pthread_mutex_unlock(&lock);
        errno = EINVAL; /* postgres reads this as "old segment is gone" */
        return -1;
    }
    switch (cmd) {
    case IPC_STAT:
        if (buf) {
            memset(buf, 0, sizeof(*buf));
            buf->shm_segsz = segments[i].size;
            buf->shm_nattch = (unsigned long)segments[i].nattch;
            buf->shm_cpid = segments[i].cpid;
            buf->shm_lpid = getpid();
            buf->shm_perm.__key = segments[i].key;
            buf->shm_perm.uid = getuid();
            buf->shm_perm.cuid = getuid();
            buf->shm_perm.gid = getgid();
            buf->shm_perm.cgid = getgid();
            buf->shm_perm.mode = 0600;
        }
        break;
    case IPC_RMID:
        segments[i].removed = 1;
        maybe_free(i);
        break;
    case IPC_SET:
        break;
    default:
        pthread_mutex_unlock(&lock);
        errno = EINVAL;
        return -1;
    }
    pthread_mutex_unlock(&lock);
    return 0;
}

/* Plain names too, matching libandroid-shmem's exports. */
int shmget(key_t key, size_t size, int flags) __attribute__((alias("libandroid_shmget")));
void *shmat(int shmid, const void *shmaddr, int shmflg) __attribute__((alias("libandroid_shmat")));
int shmdt(const void *shmaddr) __attribute__((alias("libandroid_shmdt")));
int shmctl(int shmid, int cmd, struct shmid_ds *buf) __attribute__((alias("libandroid_shmctl")));
