export interface AssigneeNameParts {
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  usesStructuredInput: boolean;
}

function cleanNamePart(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  return value.trim().replace(/\s+/g, ' ') || null;
}

export function resolveAssigneeName(input: {
  firstName?: unknown;
  lastName?: unknown;
  fullName?: unknown;
}): AssigneeNameParts {
  const firstName = cleanNamePart(input.firstName);
  const lastName = cleanNamePart(input.lastName);
  const usesStructuredInput = firstName !== null || lastName !== null;

  if (usesStructuredInput) {
    return {
      firstName,
      lastName,
      fullName: [firstName, lastName].filter(Boolean).join(' ') || null,
      usesStructuredInput,
    };
  }

  const legacyFullName = cleanNamePart(input.fullName);
  if (!legacyFullName) {
    return { firstName: null, lastName: null, fullName: null, usesStructuredInput: false };
  }

  const [legacyFirstName, ...legacyLastNameParts] = legacyFullName.split(' ');
  return {
    firstName: legacyFirstName || null,
    lastName: legacyLastNameParts.join(' ') || null,
    fullName: legacyFullName,
    usesStructuredInput: false,
  };
}
