import { Request } from 'express';
import { URL } from 'node:url';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { jwtConfigFactory } from '@Config';
import { AuthenticatedUser, Environment, JwtPayload, UserType } from '../types';
import { JWT_AUTH } from '../common.constants';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, JWT_AUTH) {
  constructor(
    @Inject(jwtConfigFactory.KEY)
    config: ConfigType<typeof jwtConfigFactory>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        JwtStrategy.fromCookie,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: config.secret,
    });
  }

  private static getCookiePrefix(ut: UserType) {
    if (
      process.env.NODE_ENV !== Environment.Production ||
      process.env.APP_ENV === Environment.Production
    ) {
      return `__${ut}__`;
    } else {
      return `${process.env.APP_ENV}__${ut}__`;
    }
  }

  private static fromCookie(req: Request): string | null {
    if (req.headers.referer) {
      const requestedDomain = new URL(req.headers.referer).host;

      if (
        process.env.ADMIN_WEB_URL &&
        requestedDomain === new URL(process.env.ADMIN_WEB_URL).host &&
        req.cookies &&
        JwtStrategy.getCookiePrefix(UserType.Admin) + 'authToken' in req.cookies
      ) {
        return req.cookies[
          JwtStrategy.getCookiePrefix(UserType.Admin) + 'authToken'
        ];
      }

      if (
        process.env.APP_WEB_URL &&
        requestedDomain === new URL(process.env.APP_WEB_URL).host &&
        req.cookies &&
        JwtStrategy.getCookiePrefix(UserType.User) + 'authToken' in req.cookies
      ) {
        return req.cookies[
          JwtStrategy.getCookiePrefix(UserType.User) + 'authToken'
        ];
      }
    }

    return null;
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    return {
      id: payload.sub,
      type: payload.type,
    };
  }
}
