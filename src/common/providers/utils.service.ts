import crypto from 'crypto';
import { customAlphabet } from 'nanoid';
import { ethers } from 'ethers';
import _ from 'lodash';
import { plainToInstance } from 'class-transformer';
import { validateOrReject } from 'class-validator';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Environment, EnvironmentVariables, UserType } from '../types';

@Injectable()
export class UtilsService {
  constructor(
    private readonly configService: ConfigService<EnvironmentVariables, true>,
  ) {}

  isProduction(): boolean {
    return this.configService.get('NODE_ENV') === Environment.Production;
  }

  isProductionApp(): boolean {
    if (this.isProduction()) {
      return this.configService.get('APP_ENV') === Environment.Production;
    }
    return false;
  }

  getCookiePrefix(ut: UserType) {
    if (!this.isProduction() || this.isProductionApp()) {
      return `__${ut}__`;
    } else {
      return `${this.configService.get('APP_ENV')}__${ut}__`;
    }
  }

  generateSalt(length = 16): string {
    return crypto.randomBytes(length).toString('hex');
  }

  hashPassword(data: string, salt: string, length: number): string {
    return crypto.scryptSync(data, salt, length).toString('hex');
  }

  generateRandomToken(length?: number): string {
    const alphabet =
      '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    const nanoid = customAlphabet(alphabet);
    return nanoid(length);
  }

  toEnumValue<T>(value: string | number, capitalize = true): T {
    if (typeof value === 'string' && capitalize) {
      value = _.capitalize(value);
    }
    return value as T;
  }

  exclude<T, Key extends keyof T>(
    obj: T,
    keys: Key[],
    enableClone = false,
  ): Omit<T, Key> {
    if (enableClone) {
      const clone = _.cloneDeep<T>(obj);
      for (const key of keys) {
        delete clone[key];
      }
      return clone;
    } else {
      for (const key of keys) {
        delete obj[key];
      }
      return obj;
    }
  }

  msToDay(ms: number): number {
    return Math.floor(ms / 86400000);
  }

  msToMin(ms: number): number {
    return Math.floor(ms / 60000);
  }

  msToHr(ms: number): number {
    return Math.floor(ms / 3600000);
  }

  msToSec(ms: number): number {
    return Math.floor(ms / 1000);
  }

  msToHuman(
    ms: number,
    options?: {
      maxUnit?: 'day' | 'hour' | 'minute' | 'second';
    },
  ): string {
    options = {
      maxUnit: options?.maxUnit || 'day',
    };

    const dateProperties: Record<string, number> = {};

    if (options.maxUnit === 'day') {
      dateProperties.day = this.msToDay(ms);
      dateProperties.hour = this.msToHr(ms) % 24;
      dateProperties.minute = this.msToMin(ms) % 60;
      dateProperties.second = this.msToSec(ms) % 60;
    }

    if (options.maxUnit === 'hour') {
      dateProperties.hour = this.msToHr(ms);
      dateProperties.minute = this.msToMin(ms) % 60;
      dateProperties.second = this.msToSec(ms) % 60;
    }

    if (options.maxUnit === 'minute') {
      dateProperties.minute = this.msToMin(ms);
      dateProperties.second = this.msToSec(ms) % 60;
    }

    if (options.maxUnit === 'second') {
      dateProperties.second = this.msToSec(ms);
    }

    return Object.entries(dateProperties)
      .filter((val) => val[1] !== 0)
      .map((val) => val[1] + ' ' + (val[1] !== 1 ? val[0] + 's' : val[0]))
      .join(', ');
  }

  async transform<T extends object, V>(
    cls: new (...args: any[]) => T,
    plain: V,
  ): Promise<T> {
    const instance = plainToInstance(cls, plain, {
      enableImplicitConversion: true,
    });
    await validateOrReject(instance, {
      whitelist: true,
      forbidUnknownValues: true,
    });
    return instance;
  }

  async sleep(ms: number) {
    return await new Promise((resolve) => setTimeout(resolve, ms));
  }

  isZeroAddress(address: string): boolean {
    return address === ethers.ZeroAddress;
  }

  async rerunnable<T>(
    fn: () => Promise<T>,
    maxRetries: number,
    sleep?: number,
  ): Promise<T> {
    let attempt = 0;

    do {
      attempt++;
      if (attempt > 1 && sleep) {
        await this.sleep(sleep);
      }

      try {
        return await fn();
      } catch (err) {
        if (attempt === maxRetries) {
          throw err;
        }
      }
    } while (attempt < maxRetries);

    throw new Error('Unexpected error occurred');
  }

  async occrunnable<T>(fn: () => Promise<T>): Promise<T> {
    do {
      try {
        return await fn();
      } catch (err) {
        if (err.code !== 'P2025') {
          throw err;
        }
      }
    } while (true);
  }
}
