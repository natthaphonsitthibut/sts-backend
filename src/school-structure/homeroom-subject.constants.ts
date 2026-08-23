/**
 * The subject every classroom has without anyone entering it.
 *
 * โฮมรูม is a normal subject offering that exists the moment a classroom is
 * created. It does not depend on a homeroom teacher or timetable assignment.
 * Keeping the code in one place lets room creation and migrations enforce the
 * same invariant without duplicating the domain value.
 */
export const HOMEROOM_SUBJECT_CODE = 'HOMEROOM101';
export const HOMEROOM_SUBJECT_NAME_TH = 'โฮมรูม';
