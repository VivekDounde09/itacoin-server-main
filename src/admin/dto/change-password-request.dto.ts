import { IsString, IsStrongPassword } from 'class-validator';

export class ChangePasswordRequestDto {
  @IsString()
  oldPassword: string;

  @IsStrongPassword()
  newPassword: string;
}
