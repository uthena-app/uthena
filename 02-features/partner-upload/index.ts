// Public barrel for the partner-upload feature (P12.7 Slices 1+2 +
// P12.8 Slice 1).
//
// The page route + tests import from this file so call sites stay
// stable across the Slices 3-5 expansion (Files / Pricing /
// Review). Slice 1 exports the Step 1 surface; Slice 2 adds the
// Step 2 Curriculum surface + the curriculum-ops pure helpers + the
// Step 2 Curriculum schema; P12.8 Slice 1 adds the upload-pipeline
// data surface (state machine + mime/size constants + per-kind
// storage-path builder) + the createPartnerFileUpload + setPartnerUploadFailed
// server actions + the getMyPartnerUploads RSC query. Each later
// slice extends the barrel in place.

// Queries
export {
  UPLOAD_FIRST_STEP,
  UPLOAD_LAST_STEP,
  UPLOAD_TOTAL_STEPS,
  UPLOAD_STEP_DETAILS,
  UPLOAD_STEP_CURRICULUM,
  UPLOAD_STEP_FILES,
  UPLOAD_STEP_PRICING,
  UPLOAD_STEP_REVIEW,
  UPLOAD_STEPS,
  getMyUploadDraft,
  type UploadDraft,
  type UploadDraftResult,
  type UploadDraftStatus,
  type UploadStepId,
} from './queries/getMyUploadDraft'
export {
  getMyPartnerUploads,
  type GetMyPartnerUploadsInput,
  type PartnerUploadRow,
  type GetMyPartnerUploadsResult,
} from './queries/getMyPartnerUploads'

// Actions
export { saveUploadDraftAction } from './actions/saveUploadDraft'
export {
  createPartnerFileUploadAction,
  CreatePartnerFileUploadInput,
  type CreatePartnerFileUploadInputT,
  type CreatePartnerFileUploadResult,
  type CreatePartnerFileUploadErrorCode,
  type UploadTarget,
} from './actions/createPartnerFileUpload'
export {
  setPartnerUploadFailedAction,
  SetPartnerUploadFailedInput,
  type SetPartnerUploadFailedInputT,
  type SetPartnerUploadFailedResult,
  type SetPartnerUploadFailedErrorCode,
} from './actions/setPartnerUploadFailed'

// Helpers
export {
  parseRequestedUploadStep,
  parseUploadStepValue,
} from './lib/parseStep'
export {
  CURRICULUM_DURATION_MAX_SECONDS,
  CURRICULUM_ID_MAX,
  CURRICULUM_MAX_LESSONS_PER_MODULE,
  CURRICULUM_MAX_MODULES,
  CURRICULUM_SUMMARY_MAX,
  CURRICULUM_TITLE_MAX,
  CurriculumPayload,
  DetailsPayload,
  LessonPayload,
  ModulePayload,
  SaveUploadDraftInput,
  UPLOAD_FIRST_STEP as SAVE_UPLOAD_FIRST_STEP,
  UPLOAD_LAST_STEP as SAVE_UPLOAD_LAST_STEP,
  payloadForStep,
  type CurriculumPayloadT,
  type DetailsPayloadT,
  type LessonPayloadT,
  type ModulePayloadT,
  type SaveUploadDraftInputT,
  type SaveUploadDraftResult,
} from './lib/saveUploadDraftSchema'
export {
  appendLesson,
  appendModule,
  countLessons,
  insertModuleAt,
  lessonMoveBounds,
  makeCurriculumId,
  moduleMoveBounds,
  moveLessonById,
  moveModuleById,
  removeLessonById,
  removeModuleById,
  totalLessonSeconds,
  MAX_LESSONS_PER_MODULE,
  MAX_MODULES,
  type LessonShape,
  type ModuleShape,
} from './lib/curriculumOps'

// Upload-pipeline (P12.8 Slice 1) — pure helpers + types
export {
  UPLOAD_VIDEO_MIME_TYPES,
  UPLOAD_SOURCE_MIME_TYPES,
  UPLOAD_SALES_MATERIAL_MIME_TYPES,
  UPLOAD_VIDEO_MAX_BYTES,
  UPLOAD_SOURCE_MAX_BYTES,
  UPLOAD_SALES_MATERIAL_MAX_BYTES,
  UPLOAD_FILENAME_MAX_LENGTH,
  allowedMimesForUploadKind,
  buildPartnerStoragePath,
  defaultExtensionForKind,
  extensionFromFilename,
  isMimeAllowedFor,
  maxBytesForUploadKind,
  sanitizePartnerFilename,
} from './lib/upload-kinds'
export {
  partnerUploadState,
  partnerUploadStateIsEncodingTerminal,
  partnerUploadStateIsReady,
  partnerUploadStateIsReplaceable,
  partnerUploadStateIsScanTerminal,
  PARTNER_UPLOAD_STATE_LABELS,
  PARTNER_UPLOAD_STATE_TONE,
  type PartnerUploadState,
} from './lib/upload-pipeline-state'

// Components
export { UploadShell, type UploadShellProps } from './components/UploadShell'
export { DetailsStep, type DetailsStepProps } from './components/DetailsStep'
export { CurriculumStep, type CurriculumStepProps } from './components/CurriculumStep'
export { StepPlaceholder, type StepPlaceholderProps } from './components/StepPlaceholder'
