export const TRUCK_TYPES = ["10ft","15ft","20ft","26ft","Cargo","Pickup","Flatbed","Refer","Box","Spec"]

export const LINE = {
  RL:   { bg:"#84cc16", text:"#1a2e05", label:"Ready Line"    },
  WL:   { bg:"#7dd3fc", text:"#0c2a3e", label:"Wash Line"     },
  SRL:  { bg:"#f1f5f9", text:"#0f172a", label:"Service Ready" },
  SL:   { bg:"#f87171", text:"#7f1d1d", label:"Service Line"  },
  SHOP: { bg:"#e8b4bc", text:"#111827", label:"Shop/Deadline"  },
}

export const GROUND_REASONS = ["CFI","Breakdown","Accident","Routine Service"]
export const PM_REASONS     = ["Routine PM","CFI","Breakdown","Accident"]
export const PM_STATUSES    = ["Flagged","Scheduled","Dropped Off","In Progress","Ready","Picked Up"]
export const GROUND_PRIORITY = { CFI:"urgent", Accident:"urgent", Breakdown:"normal", "Routine Service":"low" }

export const INIT_STATE = {
  units:             [],
  reso:              Object.fromEntries(TRUCK_TYPES.map(t => [t, []])),
  tomorrow:          Object.fromEntries(TRUCK_TYPES.map(t => [t, []])),
  pms:               [],
  grounds:           [],
  hikes:             [],
  sent:              [],
  checkins:          [],
  tasks:             [],
  contacts:          [],
  ownership:         [],
  branchHikeHistory: {},
  dayNum:            1,
}
