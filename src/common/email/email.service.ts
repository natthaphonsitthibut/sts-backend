import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { emailConfig } from '../../config/email.config';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    @Inject(emailConfig.KEY)
    private readonly config: ConfigType<typeof emailConfig>,
  ) {}

  async sendOTP(
    email: string,
    code: string,
    expiresInMinutes = 10,
  ): Promise<{ success: boolean; provider: string }> {
    if (!this.config.enabled || !this.config.user) {
      this.logger.log('--------------------------------------------------');
      this.logger.log(`[SIMULATED EMAIL] To: ${email}`);
      this.logger.log(`[SUBJECT]: รหัส OTP สำหรับเข้าใช้งานระบบ STS`);
      this.logger.log(`[BODY]: รหัส OTP ของคุณคือ: ${code}`);
      this.logger.log('--------------------------------------------------');
      return { success: true, provider: 'SIMULATOR' };
    }

    const transporter = nodemailer.createTransport({
      host: this.config.host,
      port: this.config.port,
      secure: this.config.port === 465,
      auth: {
        user: this.config.user,
        pass: this.config.pass,
      },
    });

    try {
      await transporter.sendMail({
        from: this.config.from,
        to: email,
        subject: 'รหัส OTP สำหรับเข้าใช้งานระบบ STS',
        text: `รหัส OTP สำหรับเข้าใช้งานระบบของคุณคือ: ${code}\n\nรหัสนี้จะหมดอายุภายใน ${expiresInMinutes} นาที`,
        html: `<div style="font-family: sans-serif; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
                 <h2 style="color: #1e40af;">ยืนยันตัวตนระบบ STS</h2>
                 <p>รหัส OTP สำหรับเข้าใช้งานของคุณคือ:</p>
                 <div style="font-size: 32px; font-weight: bold; color: #1e40af; letter-spacing: 4px; margin: 20px 0;">${code}</div>
                 <p style="color: #64748b; font-size: 14px;">รหัสนี้จะหมดอายุภายใน ${expiresInMinutes} นาที</p>
               </div>`,
      });
      return { success: true, provider: 'SMTP' };
    } catch (err) {
      this.logger.error(`Email Error: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  }
}
