import type {
  ArrangementStatus,
  BookingCategory,
  BookingStatus,
  BudgetBasis,
  BudgetComponent,
  CostSplit,
  DateFlexibility,
  DecisionStatus,
  EventKind,
  EventStatus,
  MemberRole,
  OptionCategory,
  OptionStatus,
  ParticipantStatus,
  PreferenceKind,
  PreferenceStrength,
  RecordOrigin,
  TaskPriority,
  TaskStatus,
  TripStage,
  TripStartMode,
} from "@/generated/prisma/enums";

export const TRIP_STAGE_LABELS: Record<TripStage, string> = {
  DREAMING: "Dreaming",
  PLANNING: "Planning",
  BOOKING: "Booking",
  READY: "Ready to go",
  COMPLETED: "Completed",
};

export const START_MODE_LABELS: Record<TripStartMode, string> = {
  KNOWN_DESTINATION: "Known destination",
  VIBE: "Vibe first",
  DISCOVER: "Open to ideas",
  MANUAL: "Started manually",
};

export const DATE_FLEXIBILITY_LABELS: Record<DateFlexibility, string> = {
  UNKNOWN: "Not decided",
  FIXED: "Fixed dates",
  FLEXIBLE: "Flexible",
};

export const BUDGET_BASIS_LABELS: Record<BudgetBasis, string> = {
  UNKNOWN: "Not set",
  PER_PERSON: "Per person",
  TOTAL: "Whole group",
};

export const BUDGET_COMPONENT_LABELS: Record<BudgetComponent, string> = {
  FLIGHTS: "Flights",
  LODGING: "Lodging",
  ACTIVITIES: "Activities",
  FOOD: "Food",
  LOCAL_TRANSPORT: "Local transport",
};

export const ARRANGEMENT_LABELS: Record<ArrangementStatus, string> = {
  UNKNOWN: "Unknown",
  NOT_NEEDED: "Not needed",
  NEEDED: "Still needed",
  IN_PROGRESS: "In progress",
  BOOKED: "Booked",
};

export const MEMBER_ROLE_LABELS: Record<MemberRole, string> = {
  ORGANIZER: "Organizer",
  MEMBER: "Member",
};

export const PREFERENCE_KIND_LABELS: Record<PreferenceKind, string> = {
  INTEREST: "Interest",
  TRAVEL_STYLE: "Travel style",
  ACCESSIBILITY: "Accessibility",
  DIETARY: "Dietary",
  LANGUAGE: "Language",
  LODGING: "Lodging",
  TRANSPORT: "Transport",
  ACTIVITY: "Activity",
  BUDGET: "Budget",
  OTHER: "Other",
};

export const PREFERENCE_STRENGTH_LABELS: Record<PreferenceStrength, string> = {
  REQUIREMENT: "Must have",
  PREFERENCE: "Nice to have",
};

export const ORIGIN_LABELS: Record<RecordOrigin, string> = {
  USER: "Added by a member",
  ATLAS: "Suggested by Atlas",
  RESEARCH_PROVIDER: "Live search result",
  SAMPLE_DATA: "Sample data",
};

export const OPTION_CATEGORY_LABELS: Record<OptionCategory, string> = {
  DESTINATION: "Destination",
  LODGING: "Stay",
  FLIGHT: "Flight",
  TRANSPORT: "Transport",
  ACTIVITY: "Activity",
  FOOD: "Food & drink",
  OTHER: "Other",
};

export const OPTION_STATUS_LABELS: Record<OptionStatus, string> = {
  SUGGESTED: "Suggested",
  SHORTLISTED: "Shortlisted",
  APPROVED: "Approved",
  BOOKED: "Booked",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  SUGGESTED: "Suggested",
  OPEN: "Open",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
};

export const DECISION_STATUS_LABELS: Record<DecisionStatus, string> = {
  OPEN: "Open",
  RESOLVED: "Resolved",
  CANCELLED: "Cancelled",
};

export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  SUGGESTED: "Suggestion",
  PLANNED: "Planned",
  CONFIRMED: "Confirmed",
  CANCELLED: "Cancelled",
};

export const EVENT_KIND_LABELS: Record<EventKind, string> = {
  ACTIVITY: "Activity",
  MEAL: "Meal",
  TRANSFER: "Transfer",
  FLIGHT: "Flight",
  LODGING: "Lodging",
  FREE_TIME: "Free time",
  OTHER: "Other",
};

export const BOOKING_CATEGORY_LABELS: Record<BookingCategory, string> = {
  FLIGHT: "Flights",
  ACCOMMODATION: "Accommodation",
  GROUND_TRANSPORT: "Ground transport",
  ACTIVITY: "Activities & reservations",
  OTHER: "Other",
};

export const BOOKING_CATEGORY_SINGULAR: Record<BookingCategory, string> = {
  FLIGHT: "Flight",
  ACCOMMODATION: "Accommodation",
  GROUND_TRANSPORT: "Ground transport",
  ACTIVITY: "Activity or reservation",
  OTHER: "Other",
};

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  PLANNED: "Not booked yet",
  BOOKED: "Booked",
  CONFIRMED: "Confirmed",
  CANCELLED: "Cancelled",
};

export const COST_SPLIT_LABELS: Record<CostSplit, string> = {
  SHARED_EQUALLY: "Total, split equally",
  PER_PERSON: "Price per traveler",
  CUSTOM: "Custom shares",
};

export const PARTICIPANT_STATUS_LABELS: Record<ParticipantStatus, string> = {
  CONSIDERING: "Considering",
  BOOKED: "Booked",
};
