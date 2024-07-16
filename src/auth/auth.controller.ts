import {
  Req,
  Res,
  Controller,
  Post,
  UseGuards,
  HttpCode,
  Inject,
} from '@nestjs/common';
import { CookieOptions, Request, Response } from 'express';
import { ConfigType } from '@nestjs/config';
import {
  AuthenticatedRequest,
  BaseController,
  JwtAuthGuard,
  UtilsService,
  ValidatedUser,
  UserType,
} from '@Common';
import { appConfigFactory, authConfigFactory } from '@Config';
import { AuthService } from './auth.service';
import { LocalAuthGuard } from './guards';

@Controller('auth')
export class AuthController extends BaseController {
  constructor(
    @Inject(appConfigFactory.KEY)
    private readonly appConfig: ConfigType<typeof appConfigFactory>,
    @Inject(authConfigFactory.KEY)
    private readonly config: ConfigType<typeof authConfigFactory>,
    private readonly authService: AuthService,
    private readonly utilsService: UtilsService,
  ) {
    super();
  }

  private setCookie(
    res: Response,
    key: string,
    value: string,
    options?: CookieOptions,
  ): void {
    const isProduction = this.utilsService.isProduction();
    res.cookie(key, value, {
      expires: options?.expires,
      domain:
        options?.domain !== undefined
          ? options.domain
          : isProduction
          ? this.appConfig.domain
          : 'localhost',
      httpOnly: options?.httpOnly !== undefined ? options.httpOnly : true,
      sameSite:
        options?.sameSite !== undefined
          ? options.sameSite
          : isProduction
          ? 'strict'
          : 'none',
      secure: options?.secure !== undefined ? options.secure : true,
    });
  }

  private removeCookie(
    res: Response,
    key: string,
    options?: CookieOptions,
  ): void {
    const isProduction = this.utilsService.isProduction();
    res.clearCookie(key, {
      domain:
        options?.domain !== undefined
          ? options.domain
          : isProduction
          ? this.appConfig.domain
          : 'localhost',
      httpOnly: options?.httpOnly !== undefined ? options.httpOnly : true,
      sameSite:
        options?.sameSite !== undefined
          ? options.sameSite
          : isProduction
          ? 'strict'
          : 'none',
      secure: options?.secure !== undefined ? options.secure : true,
    });
  }

  private setAuthCookie(
    res: Response,
    accessToken: string,
    userType: UserType,
  ): void {
    const expirationTime = this.config.authCookieExpirationTime();

    this.setCookie(
      res,
      this.utilsService.getCookiePrefix(userType) + 'authToken',
      accessToken,
      {
        expires: expirationTime,
        httpOnly: true,
      },
    );

    this.setCookie(
      res,
      this.utilsService.getCookiePrefix(userType) + 'isLoggedIn',
      'true',
      {
        expires: expirationTime,
        httpOnly: false,
      },
    );
  }

  @UseGuards(LocalAuthGuard)
  @HttpCode(200)
  @Post('login')
  async login(
    @Req() req: Request & { user: ValidatedUser },
    @Res({ passthrough: true }) res: Response,
  ) {
    const { accessToken, type } = await this.authService.login(
      req.user.id,
      req.user.type,
    );
    this.setAuthCookie(res, accessToken, type);
    return { status: 'success' };
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  async logout(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ctx = this.getContext(req);
    this.removeCookie(
      res,
      this.utilsService.getCookiePrefix(ctx.user.type) + 'authToken',
      {
        httpOnly: true,
      },
    );
    this.removeCookie(
      res,
      this.utilsService.getCookiePrefix(ctx.user.type) + 'isLoggedIn',
      {
        httpOnly: false,
      },
    );
    return { status: 'success' };
  }
}
