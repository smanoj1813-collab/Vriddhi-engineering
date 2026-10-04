/** Split the Question Bank's newline-delimited learning-outcomes field into clean rows. */
export function parseLearningOutcomes(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((outcome) => outcome.trim())
    .filter(Boolean);
}
