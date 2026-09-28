# ToDos

Completed items move to `toDone.md`.

Grouped by effort. Estimates are from reading the code, not guessing. The quick-win
section is empty for now — what remains genuinely needs a new mechanism or touches
the data model.

## Medium — needs a new mechanism, but a contained one

- **Multi-park day editor** — list every venue for that day together, so the mileage can be adjudicated across them rather than one field at a time.
- **One-way leg entry for multi-park days.** Round trip is the wrong model when the
  day is home→A→B→home. Depends on the editor above, so they land together.
- **Multiple vehicles** with a default and per-trip attribution. A new reference
  entity and an optional trip field; the mileage layer changes very little.

## Large — changes the data model

- **Trip blocks** for out-of-town tournaments, so travel, lodging and meals attach
  to a block and spread across its games. You suspected this needs a new relational
  structure; it does — a parent entity above trips.
- **Chart type options** (line, donut, radar). Deliberately last, because it is the
  item most likely to make the app worse. A donut only works at six segments or
  fewer, and radar is genuinely poor for comparing magnitudes — it is worth picking
  the right alternate form per chart rather than offering a universal switcher.
- **API support** (Assignr, RefTown), with credentials, OAuth/JWT and cloud storage.
  Still the big lift you called it. The import profile abstraction means the parsing
  half is ready; the blocker is that a browser cannot hold a client secret, so this
  needs a local helper or a backend.

## Testing
- 161 of 317 tests need the private submodules and skip without them, so a fresh
  clone runs 156 (measured, not estimated). If a second contributor joins, decide
  whether the public sample should grow to cover more cases first.

## Data errors
- **A paid cancellation breaks the fee reconciliation.** Overview says forfeited,
  less pay above rate and income from games with no rate, "offsets it to" the net
  gap (`scheduledAll − gross`). A cancellation that paid part of its fee counts only
  the unpaid part as forfeited, but its payment is kept out of `gross` by design, so
  the pieces fall short of the gap by exactly that payment. On the sample: $152.50 −
  $28 − $50 = $74.50 against a $97 gap; the $22.50 is the half-paid rainout. The
  real export has no paid cancellation, so no figure shown so far is wrong. Needs a
  decision first: either a paid cancellation's money is income (it arrived), or it
  needs its own term in the sentence.

## Features
- **Gear inventory, collections and per-game gear.** Replaces the two rough gear
  ideas that were here (user-made items and presets; per-item tracking such as mask 1 /
  mask 2).
  - **Catalog.** A seeded set of gear products: shirts, shields, jackets, hats, chest
    protectors, ball bags and so on, each with brand, colour and SKU / product number
    where known. Users can add their own, including an item found online by its product
    number. These are product types, not the things a user owns.
  - **Owned items.** A user's own gear, each one a catalog product plus a date of
    purchase or acquisition. Duplicates are separate items, so "Black V3 #1" is one
    specific short-sleeve black baseball shirt of a known brand and SKU, distinct from
    #2.
  - **Collections.** Named sets of owned items, such as "BB: Plate Gear" or "SB: Bases",
    so a whole kit goes on a game in one step. A shirt can be picked on its own, either
    a variant ("BB: Black V3, shortsleeve") or a specific item ("Black V3 #1").
  - **On a game.** An *Add gear* button on the game entry opens a picker for a
    collection, individual items and the shirt. Nothing shows until something is added:
    no rows of empty checkboxes. Added gear appears as removable chips, as call tags do
    now.
  - **Gear tab — built** (`views/Gear.tsx`; tables `gearProducts`, `gearItems`,
    `gearSets` at schema v5). Sets, owned items with purchase date and retire /
    unretire, a size and price paid per item (on the piece, not the product, since one
    shirt can be owned in two sizes and bought at two prices), and a collapsible catalog with 20 unbranded seed products plus the
    user's own (brand, colour, SKU, shop link). A retired item stays in its sets,
    marked, but is no longer offered for adding. Deleting an item removes it from
    every set; deleting a product that an item is still of is refused. Still to add
    here: a variant pick ("BB: Black V3, shortsleeve") alongside the specific item.
  - **Consolidate onto the Gear tab** — candidates, none done yet:
    - *Reference data → Sports & gear* holds the position prep deltas and the gear
      modifiers (full gear, shield, casual, cold, rain). The gear half belongs here;
      the per-sport prep and wrap minutes can stay under Reference.
    - `SportProfile.defaultGearLevel` (plate or base per sport) is the natural seed
      for a default set per sport — `GearSet.sportCode` already exists for that.
    - "Shield" is a modifier checkbox but is really a piece of gear (a chest
      protector type). Once games carry items, it can be read from what was worn.
    - Gear-category general expenses (Tax view) are purchases of the items tracked
      here. An item's purchase could offer to log the expense, or an expense could
      link to the item, so the cost and the lifespan live together.
  - **Not yet:** no charts or reports on gear. The data is collected for later
    questions such as "which shirt colour is worn most" and "the most popular
    chest-protector brand", which is what the anonymised global tracking below would
    answer. Lifespan figures (games per item, purchase to retirement) come from the
    same data later.
  - **Decide first:**
    - The existing position selector and modifier checkboxes (`GearCell` in
      `Trips.tsx`) feed prep time in `derive/time.ts` through `gearLevel` and
      `gearModifiers` on the game annotation. Either keep them beside the new picker,
      or have collections carry the prep-time effect and move the old fields over.
    - Where the seeded catalog lives: shipped with the app, like the other seed tables,
      or fetched later from the cloud store.
    - Keep product IDs stable and free of personal details, because cross-user
      counting depends on every user's "Brand X chest protector" having the same ID.
      User-added products get a random local ID today, so the same product added by
      two users is two IDs; a shared catalog has to reconcile them.
  - **Next:** a gear list on `GameAnnotation` (so a re-import keeps it like the other
    game notes) and the *Add gear* button on the game entry.
  - **More Features:** 
    - The full catalogue could get uncomfortably large. We should filter results to show 50 items at a time, with a "Load more" button to fetch additional results, as well as a toggle to view more items: 100, 200, 500, etc.
    - We should have a filter for the catalogue, to display items by sport, brand, etc. We will need to add a sport field to the gear entries. Ask the user to choose from a list of sports, but fallback to an inferred sport based on the user's profile, with sports attributed.
    - Add custom fields to specific gear, like `ball_first`(boolean) and `dial_count`(integer) for indicators. Other gear might have a field for hand dominance `ambidextrous`(boolean) or `right_handed`(boolean (if ambidextrous=false)).
  - We should track the UPC value, over the SKU or Product number, though we can leave those values. SKU would likely be a sub-object key, where the SKU is matched with a retail vendor. We would additionally need a system ID to track individual gear items, since UPC values may not be reliable or available with user-supplied data. For identifying duplicate gear entries, we should prioritize matching values in this order:
    1. ItemID
    2. UPC
    3. Brand Product ID
    4. Retail Vendor / SKU pair
- Anonymized global data tracking: collect and track all metrics across all users, but anonymized to protect user privacy. This will allow us to track popular brands for gear, frequency of calls, contrast those frequencies by region, age, and other demographic factors.
- consider other user metrics, like age, sex, years of experience. Offer users to opt-out, but reinforce that it's anonymized, and used for general analytics and trend tracking.
- Demographic reviews: consider an option for officials to rate gear, brands, fields, leagues (with breakdowns for players, coaches, parents, boardmembers, surrounding neighborhoods, etc.), rulesets, concessions, facilities, and other elements.
