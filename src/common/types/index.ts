import { Request } from 'express';
import { IsEnum, IsNumber, IsString } from 'class-validator';

export enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

export enum Network {
  Devnet = 'devnet',
  Testnet = 'testnet',
  Mainnet = 'mainnet',
}

export class EnvironmentVariables {
  @IsEnum(Environment)
  NODE_ENV: Environment;

  @IsEnum(Environment)
  APP_ENV: Environment;

  @IsEnum(Network)
  NETWORK: Network;

  @IsNumber()
  PORT: number;

  @IsString()
  DATABASE_URL: string;

  @IsString()
  REDIS_URI: string;

  @IsString()
  STORAGE_DIR: string;

  @IsString()
  LOG_DIR: string;
}

/**
 * ExcludeUndefinedIf<ExcludeUndefined, T>
 *
 * If `ExcludeUndefined` is `true`, remove `undefined` from `T`.
 * Otherwise, constructs the type `T` with `undefined`.
 */
export type ExcludeUndefinedIf<
  ExcludeUndefined extends boolean,
  T,
> = ExcludeUndefined extends true ? Exclude<T, undefined> : T | undefined;

export interface File {
  /** Name of the form field associated with this file. */
  fieldname: string;
  /** Name of the file on the uploader's computer. */
  originalname: string;
  /**
   * Value of the `Content-Transfer-Encoding` header for this file.
   * @deprecated since July 2015
   * @see RFC 7578, Section 4.7
   */
  encoding: string;
  /** Value of the `Content-Type` header for this file. */
  mimetype: string;
  /** Size of the file in bytes. */
  size: number;
  /** `DiskStorage` only: Directory to which this file has been uploaded. */
  destination: string;
  /** `DiskStorage` only: Name of this file within `destination`. */
  filename: string;
  /** `DiskStorage` only: Full path to the uploaded file. */
  path: string;
}

export enum UserType {
  User = 'user',
  Admin = 'admin',
}

export interface JwtPayload {
  readonly sub: string;
  readonly type: UserType;
}

export interface ValidatedUser {
  readonly id: string;
  readonly type: UserType;
}

export interface AuthenticatedUser {
  readonly id: string;
  readonly type: UserType;
}

export interface Context {
  readonly user: AuthenticatedUser;
}

export interface AuthenticatedRequest extends Request {
  readonly user: AuthenticatedUser;
}

export enum MailTemplate {
  VerificationCode = 'verification-code',
}

export type Language = 'en' | 'it';

export enum MainnetChain {
  Binance = 'binance',
}

export enum TestnetChain {
  BinanceTestnet = 'binance_testnet',
}

export enum DevnetChain {
  Local = 'local',
}

export type Chain = DevnetChain | TestnetChain | MainnetChain;

export type NetworkChain<T> = T extends Network.Devnet
  ? DevnetChain
  : T extends Network.Testnet
  ? TestnetChain
  : T extends Network.Mainnet
  ? MainnetChain
  : T;

export enum ProviderKind {
  Http = 'http',
  Ws = 'ws',
}
