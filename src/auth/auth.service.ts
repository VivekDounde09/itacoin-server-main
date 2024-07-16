import { Injectable } from '@nestjs/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { JwtPayload, UserType } from '@Common';

export type ValidAuthResponse = {
  accessToken: string;
  type: UserType;
};

@Injectable()
export class AuthService {
  constructor(private readonly jwtService: JwtService) {}

  private generateJwt(payload: JwtPayload, options?: JwtSignOptions): string {
    return this.jwtService.sign(payload, options);
  }

  async login(userId: string, type: UserType): Promise<ValidAuthResponse> {
    return {
      accessToken: this.generateJwt({
        sub: userId,
        type,
      }),
      type,
    };
  }
}
