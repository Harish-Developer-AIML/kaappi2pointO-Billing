# Changelog

Kaappi Biller versions. `major.minor.patch`: patch = bug fixes, minor = new
features, major = big or breaking changes. Bump with `scripts/bump-version.sh`.

## 1.4.2 — 2026-11-28

- Point of Sale: "+ Other item" chip after the last category (the cart button stays).
- Cart: only the item list scrolls, so Send to kitchen / payment always stays on screen.
- Dropdowns show names, not internal ids: menu category and kitchen station, combo
  dishes, staff role, reservation table, inventory supplier and ingredient.

## 1.4.1 — 2026-11-26

- Point of Sale: "Other item (not on the menu)" in the cart: type a name,
  price and quantity for this bill only; the menu is not changed.

## 1.4.0 — 2026-11-26

- Bill logos: size slider (10–30 mm) and position (top / middle / bottom).
- Totals: one TOTAL line; subtotal only when it differs from the total;
  switches for subtotal and payment lines (Settings › Bill › Totals).
- Thermal printers: "Tamil & Indian languages + ₹" character set prints the
  bill as a picture drawn on the device (Tamil, Hindi, ₹ … print correctly).
- Point of Sale with the phone sideways: menu and cart side by side like on a
  computer; the table list scrolls and shows every table.

## 1.3.0 — 2026-11-24

- Bill logos: a left and a right logo at the top of the bill (screen/PDF and
  thermal printers), chosen in Settings › Bill.
- Menu › Upload JSON: add and update the whole menu from one file, with a
  preview first and a sample file. Nothing is deleted; no duplicates.
- Languages: English and Tamil (தமிழ்) only; Spanish/French turned off.
  Tamil covers the menu bar so far.
- Orders page: New (to accept), Online, Offline and Delivery turned off.
- Operations turned off.
- Tables: Auto / Grid / Floor plan switch; turned sideways, the floor plan
  fits the screen.
- Phones: Inventory and Settings use a section menu; ingredients as cards;
  tidier printer settings.

## 1.2.0 — 2026-11-24

- Version number shown in the app (sidebar and Settings), one `VERSION` file.
- Bluetooth thermal printers: bills, kitchen tickets, test slip and cash drawer
  print to a printer paired with the phone (Settings › General › Thermal
  printer › Bluetooth).
- Bill settings (Settings › Bill): choose what the bill shows — restaurant and
  branch name, address, phone, GSTIN, a note, title, order type, table,
  customer, GST per item and GST breakup (or no tax on the bill), footer text.
  The table number now sits on the right of the bill.
- Quick bill without a table on the Point of Sale (counter / coffee-shop sales).
- Phone bottom bar: Dashboard · Orders · Point of Sale (centre) · Menu · More.
- Tapping Point of Sale returns to the table list (also straight after Send to
  kitchen: the bottom bar stays visible over the cart); reopening a table shows
  its open order in the cart, with Bill & pay.

## 1.1.0 — 2026-11-23

- Android app runs the whole system on the phone (offline); "Join a shop".
- Mobile fixes: printing in the app, category chips, tables grid, dropdowns,
  table/floor delete, Reservations / Kitchen Display / Delivery turned off.

## 1.0.0 — 2026-11-20

- Kaappi Biller: rebranded first release.
