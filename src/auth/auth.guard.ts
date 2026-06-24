import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ANY_PERMISSIONS_KEY, PERMISSIONS_KEY, ROLES_KEY } from './permissions.decorator';
import { hasPermission } from './permissions.constants';
import { AuthActorService } from './auth-actor.service';
import type { RequestWithUser } from './auth.types';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly authActorService: AuthActorService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();

    const user = await this.authActorService.loadRequiredUser(request);
    if (!user) {
      throw new UnauthorizedException('ไม่ได้เข้าสู่ระบบ');
    }

    request.user = user;
    return true;
  }
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const anyPermissions = this.reflector.getAllAndOverride<string[]>(ANY_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const hasRequired = requiredPermissions && requiredPermissions.length > 0;
    const hasAny = anyPermissions && anyPermissions.length > 0;

    if (!hasRequired && !hasAny) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;

    if (!user) {
      throw new UnauthorizedException('ไม่ได้เข้าสู่ระบบ');
    }

    // AND set (all required) and OR set (at least one) both apply when present.
    const passesRequired =
      !hasRequired ||
      requiredPermissions.every((permission) =>
        hasPermission(user.roles, user.permissions, permission),
      );
    const passesAny =
      !hasAny ||
      anyPermissions.some((permission) => hasPermission(user.roles, user.permissions, permission));

    if (!passesRequired || !passesAny) {
      throw new ForbiddenException('ไม่มีสิทธิ์เข้าถึง');
    }

    return true;
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;

    if (!user) {
      throw new UnauthorizedException('ไม่ได้เข้าสู่ระบบ');
    }

    const hasRole = requiredRoles.some((role) => user.roles.includes(role));

    if (!hasRole) {
      throw new ForbiddenException('ไม่มีสิทธิ์เข้าถึง');
    }

    return true;
  }
}

@Injectable()
export class OptionalAuthGuard implements CanActivate {
  constructor(private readonly authActorService: AuthActorService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = await this.authActorService.loadOptionalUser(request);
    if (user) {
      request.user = user;
    }
    return true;
  }
}
