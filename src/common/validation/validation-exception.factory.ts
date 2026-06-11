import { BadRequestException, type ValidationError } from '@nestjs/common';

function flattenValidationErrors(errors: ValidationError[], parentPath?: string): string[] {
  return errors.flatMap((error) => {
    const currentPath = parentPath ? `${parentPath}.${error.property}` : error.property;
    const constraintMessages = error.constraints
      ? Object.values(error.constraints).map((message) =>
          currentPath ? `${currentPath}: ${message}` : message,
        )
      : [];
    const childMessages = error.children?.length
      ? flattenValidationErrors(error.children, currentPath)
      : [];

    return [...constraintMessages, ...childMessages];
  });
}

export function createValidationException(errors: ValidationError[]): BadRequestException {
  const messages = flattenValidationErrors(errors);

  if (messages.length === 0) {
    return new BadRequestException('Validation failed');
  }

  return new BadRequestException(messages.length === 1 ? messages[0] : messages);
}
