import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class AdminCreateOrganizationDto {
  @IsString()
  @MinLength(3)
  @MaxLength(128)
  company: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  @MaxLength(64)
  password: string;
}
