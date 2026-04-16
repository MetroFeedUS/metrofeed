# Route Branches Implementation Plan

## Current State Analysis

### Data Structure
- **Routes Index**: Flat list of `(route_id, direction_id)` pairs
- **Route Files**: One file per `(route_id, direction_id)` with single `shape[]` array
- **Green Line**: Has separate files (`Green-B`, `Green-C`, `Green-D`, `Green-E`) - branches are separate routes
- **Red Line**: Single file (`Red`) - branches are NOT separate routes, need to be extracted

### Problems
1. **No grouping metadata**: Can't tell which routes belong to the same "route label" (e.g., all Green branches)
2. **Pattern-based discovery**: Current fallback uses naming conventions (Green-B, Green-C) - brittle
3. **Red Line**: Branches aren't separate files, so pattern matching won't work
4. **GTFS pipeline**: Not generating `shapes[]` arrays yet

---

## Proposed Solution: Three-Tier Approach

### Tier 1: GTFS Pipeline (Ideal - Long Term)
**Goal**: Generate `shapes[]` arrays automatically from GTFS data

**Process**:
1. Group trips by `(route_label, direction_id)` where `route_label` comes from GTFS `routes.txt`
2. Collect all unique `shape_id`s used by those trips
3. For each `shape_id`, extract the shape geometry from `shapes.txt`
4. Output route file with `shapes[]` array containing all unique shapes

**Route File Structure**:
```json
{
  "route_id": "Red",
  "route_label": "Red Line",  // User-facing name
  "direction_id": 0,
  "direction_name": "Outbound",
  "shapes": [
    [[lat, lon], ...],  // Ashmont branch shape
    [[lat, lon], ...],  // Braintree branch shape
    [[lat, lon], ...]   // Trunk segment shape
  ],
  "stops": [...]
}
```

**Benefits**:
- ✅ Data-driven (no hard-coding)
- ✅ Works for any city/agency
- ✅ Handles any branch pattern automatically
- ✅ No pattern matching needed

---

### Tier 2: Routes Index Metadata (Medium Term)
**Goal**: Add grouping metadata to `routes_index.js` to enable branch discovery

**Routes Index Structure**:
```javascript
{
  "version": "...",
  "routes": [
    {
      "route_id": "Red",
      "route_label": "Red Line",      // NEW: User-facing group
      "route_number": "Red",
      "direction_id": 0,
      "direction_name": "Outbound",
      "route_title": "Route Red - Outbound",
      "file": "route_data/route-Red-dir0.json",
      "branch_of": null,              // NEW: If this is a branch, what's the main route_label?
      "has_branches": true            // NEW: Does this route have branches?
    },
    {
      "route_id": "Green-B",
      "route_label": "Green Line",    // NEW: All Green branches share this
      "route_number": "B",
      "direction_id": 0,
      "branch_of": "Green Line",      // NEW: This branch belongs to Green Line
      "has_branches": false
    },
    // ... Green-C, Green-D, Green-E would have same route_label
  ]
}
```

**Discovery Logic**:
```javascript
// When loading route "Red" or "Green Line":
// 1. Find all routes with same route_label and direction_id
// 2. Load their shape arrays
// 3. Combine into shapes[] array
```

**Benefits**:
- ✅ Works with existing separate branch files (Green Line)
- ✅ Can discover branches without pattern matching
- ✅ Extensible to any route structure
- ⚠️ Requires updating routes_index.js generation

---

### Tier 3: Pattern-Based Fallback (Current - Short Term)
**Goal**: Keep working until Tiers 1 & 2 are ready

**Current Implementation**:
- Detects patterns like "Green-B", "Green-C" → loads siblings
- For Red Line: Falls back to splitting at JFK/UMass (temporary)

**Limitations**:
- ⚠️ Only works for routes following naming conventions
- ⚠️ Red Line branches need separate files or GTFS extraction
- ⚠️ Not scalable to other cities

---

## Recommended Implementation Path

### Phase 1: Immediate (Keep Current + Improve)
1. ✅ Keep pattern-based fallback for Green Line (works now)
2. ✅ Document that it's temporary
3. ⚠️ For Red Line: Need to either:
   - **Option A**: Extract branch shapes from GTFS and create `route-Red-Ashmont-dir0.json`, `route-Red-Braintree-dir0.json` files
   - **Option B**: Update GTFS pipeline to generate `shapes[]` for Red Line route files

### Phase 2: Routes Index Enhancement
1. Update GTFS → routes_index.js generation to include:
   - `route_label` field (from GTFS routes.txt)
   - `branch_of` field (if route is a branch)
   - `has_branches` flag (if route has branches)
2. Update `processTrunkAndBranchRoute()` to use `route_label` for discovery
3. Remove pattern-based logic

### Phase 3: GTFS Pipeline (Ideal)
1. Update GTFS processing to generate `shapes[]` arrays
2. Remove all fallback logic
3. System becomes fully data-driven

---

## Data Model Definitions

### route_label vs route_id
- **route_label**: User-facing group name (e.g., "Green Line", "Red Line")
  - Used for grouping branches
  - What users see in UI
  - May not have a direct file (e.g., "Green Line" doesn't have a file, but "Green-B" does)

- **route_id**: File key / GTFS route_id (e.g., "Green-B", "Red", "200")
  - Used to load route files
  - May be branch-specific or main route

- **shapes[]**: Array of all unique shape geometries for a route_label
  - Generated by GTFS pipeline (ideal)
  - Or discovered from branch files (fallback)

---

## Questions to Answer

1. **Red Line Strategy**: 
   - Extract branches from GTFS now? (Option A)
   - Or wait for GTFS pipeline update? (Option B)

2. **Green Line Strategy**:
   - Keep separate branch files? (current)
   - Or consolidate into main "Green Line" file with shapes[]? (future)

3. **Routes Index Update**:
   - Can we update the GTFS → routes_index.js generation script?
   - Or should we add metadata manually for now?

---

## Next Steps

1. **Decide on Red Line approach** (extract branches now vs wait for pipeline)
2. **Update routes_index.js structure** (add route_label, branch_of fields)
3. **Refactor processTrunkAndBranchRoute()** to use route_label instead of patterns
4. **Test with Green Line** (should work immediately with route_label)
5. **Plan GTFS pipeline update** (long-term solution)


