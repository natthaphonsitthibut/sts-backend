import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer';
import { emailConfig } from '../../config/email.config';

const GMAIL_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
const REQUEST_TIMEOUT_MS = 10_000;

interface OtpEmailContent {
  subject: string;
  text: string;
  html: string;
}

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
      // Authentication factors and recipient PII must never enter application
      // logs. Tests capture this service at the boundary instead of scraping a
      // simulated OTP from process output.
      this.logger.warn('Email delivery is disabled; OTP was not sent');
      return { success: true, provider: 'SIMULATOR' };
    }

    const content = this.buildOtpContent(code, expiresInMinutes);
    const useGmailApi =
      this.config.oauthClientId && this.config.oauthClientSecret && this.config.oauthRefreshToken;

    try {
      if (useGmailApi) {
        await this.sendViaGmailApi(email, content);
        return { success: true, provider: 'GMAIL_API' };
      }

      await this.sendViaSmtp(email, content);
      return { success: true, provider: 'SMTP' };
    } catch (err) {
      this.logger.error('Email delivery failed through the configured provider');
      throw err;
    }
  }

  private buildOtpContent(code: string, expiresInMinutes: number): OtpEmailContent {
    return {
      subject: 'รหัส OTP สำหรับเข้าใช้งานระบบ STS',
      text: `รหัส OTP สำหรับเข้าใช้งานระบบของคุณคือ: ${code}\n\nรหัสนี้จะหมดอายุภายใน ${expiresInMinutes} นาที`,
      html: `<div style="font-family: sans-serif; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
               <h2 style="color: #1e40af;">ยืนยันตัวตนระบบ STS</h2>
               <p>รหัส OTP สำหรับเข้าใช้งานของคุณคือ:</p>
               <div style="font-size: 32px; font-weight: bold; color: #1e40af; letter-spacing: 4px; margin: 20px 0;">${code}</div>
               <p style="color: #64748b; font-size: 14px;">รหัสนี้จะหมดอายุภายใน ${expiresInMinutes} นาที</p>
             </div>`,
    };
  }

  private async sendViaSmtp(email: string, content: OtpEmailContent): Promise<void> {
    const transporter = nodemailer.createTransport({
      host: this.config.host,
      port: this.config.port,
      secure: this.config.port === 465,
      auth: {
        user: this.config.user,
        pass: this.config.pass,
      },
      connectionTimeout: REQUEST_TIMEOUT_MS,
      greetingTimeout: REQUEST_TIMEOUT_MS,
      socketTimeout: REQUEST_TIMEOUT_MS,
    });

    await transporter.sendMail({
      from: this.config.from,
      to: email,
      subject: content.subject,
      text: content.text,
      html: content.html,
    });
  }

  private async sendViaGmailApi(email: string, content: OtpEmailContent): Promise<void> {
    const accessToken = await this.fetchGmailAccessToken();
    const raw = await this.buildRawMessage(email, content);

    const response = await this.fetchWithTimeout(GMAIL_SEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw }),
    });

    if (!response.ok) {
      throw new Error(`Gmail API send failed with status ${response.status}`);
    }
  }

  private async fetchGmailAccessToken(): Promise<string> {
    const response = await this.fetchWithTimeout(GMAIL_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.config.oauthClientId,
        client_secret: this.config.oauthClientSecret,
        refresh_token: this.config.oauthRefreshToken,
        grant_type: 'refresh_token',
      }).toString(),
    });

    if (!response.ok) {
      throw new Error(`Gmail OAuth token refresh failed with status ${response.status}`);
    }

    const data = (await response.json()) as { access_token?: string };
    if (!data.access_token) {
      throw new Error('Gmail OAuth token refresh returned no access_token');
    }
    return data.access_token;
  }

  private buildRawMessage(email: string, content: OtpEmailContent): Promise<string> {
    const mail = new MailComposer({
      from: this.config.from,
      to: email,
      subject: content.subject,
      text: content.text,
      html: content.html,
    });

    return new Promise((resolve, reject) => {
      mail.compile().build((err: Error | null, message: Buffer) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(
          message.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
        );
      });
    });
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }
}
