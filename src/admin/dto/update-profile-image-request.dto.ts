import { IsNotEmpty, IsString } from 'class-validator';

export class UpdateProfileImageRequestDto {
  @IsString()
  @IsNotEmpty()
  profileImage: string;
}
