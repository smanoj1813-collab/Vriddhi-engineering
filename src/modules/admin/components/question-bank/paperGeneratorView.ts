// Which generator controls an employee sees. Employees get the plain exam
// setup; admin, principal, HOD and the rest keep the scheme-aware generator.
export function usesPlainExamSetup(role: string | undefined | null): boolean {
  return role === 'employee'
}
