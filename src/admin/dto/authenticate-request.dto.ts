import { IsString } from 'class-validator';

export class AuthenticateRequestDto {
  @IsString()
  password: string;
}
