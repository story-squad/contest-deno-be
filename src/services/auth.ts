import {
  Service,
  Inject,
  serviceCollection,
  jwt,
  bcrypt,
  createError,
  v5,
} from '../../deps.ts';
import env from '../config/env.ts';
import { Roles } from '../interfaces/roles.ts';
import { IUser, INewUser } from '../interfaces/users.ts';
import ResetModel from '../models/resets.ts';
import UserModel from '../models/users.ts';
import ValidationModel from '../models/validations.ts';
import BaseService from './baseService.ts';
import MailService from './mailer.ts';

@Service()
export default class AuthService extends BaseService {
  constructor(
    @Inject(UserModel) private userModel: UserModel,
    @Inject(ResetModel) private resetModel: ResetModel,
    @Inject(ValidationModel) private validationModel: ValidationModel,
    @Inject(MailService) private mailer: MailService
  ) {
    super();
  }

  public async SignUp(body: INewUser) {
    // Initialize variable to store sendTo email for validation
    let sendTo: string;
    // Underage users must have a parent email on file for validation
    if (!body.age) {
      throw createError(400, 'No age sent');
    }
    if (body.age < 13) {
      if (!body.parentEmail || body.email === body.parentEmail) {
        throw createError(
          400,
          'Underage users must have a parent email on file'
        );
      } else {
        sendTo = body.parentEmail;
      }
    } else {
      sendTo = body.email;
    }
    try {
      // Start a transaction for data integrity
      await this.db.transaction(async () => {
        // Further sanitize data
        Reflect.deleteProperty(body, 'age');
        Reflect.deleteProperty(body, 'parentEmail');

        // Create a new user object
        const hashedPassword = await this.hashPassword(body.password);
        const { id } = await this.userModel.add(
          { ...body, password: hashedPassword, roleId: Roles['user'] },
          true
        );

        // Generate Validation for user
        const { url, code } = this.generateValidationURL(body.codename, sendTo);
        await this.validationModel.add({ code, userId: id, email: sendTo });
        await this.mailer.sendValidationEmail(sendTo, url);

        this.logger.debug(`User (ID: ${id}) successfully registered`);
      });
    } catch (err) {
      this.logger.error(err);
      throw err;
    }
  }

  public async SignIn(email: string, password: string): Promise<IAuthResponse> {
    try {
      const user = await this.userModel.get({ email }, { first: true });
      if (!user) throw createError(404, 'User not found');
      if (!user.isValidated)
        throw createError(403, 'Account must be validated');

      this.logger.debug(`Verifying password for user (EMAIL: ${email})`);
      const validPassword = await bcrypt.compare(password, user.password);
      if (!validPassword) throw createError(401, 'Invalid password');
      this.logger.debug(`Password verified`);

      // Remove password hash from response body
      Reflect.deleteProperty(user, 'password');
      const token = await this.generateToken(user);
      return { user, token };
    } catch (err) {
      this.logger.error(err);
      throw err;
    }
  }

  public async Validate(email: string, token: string): Promise<IAuthResponse> {
    try {
      // Attempt to validate the user
      const userValidation = await this.userModel.getUserByResetEmail(email);
      if (!userValidation) throw createError(404, 'User not found');
      if (userValidation.isValidated) {
        throw createError(409, 'User has already been validated');
      }
      if (token !== userValidation.code) {
        throw createError(401, 'Invalid activation code');
      }

      let updatedUser: IUser | undefined;

      await this.db.transaction(async () => {
        const now = new Date().toUTCString();
        updatedUser = await this.userModel.update(userValidation.id, {
          isValidated: true,
          updatedAt: now,
        });
        await this.validationModel.update(userValidation.validationId, {
          completedAt: now,
        });
      });

      if (!updatedUser) throw createError(409, 'Could not create user');

      // Remove password hash from response body
      Reflect.deleteProperty(updatedUser, 'password');
      // Generate a JWT for the user to login
      const jwt = await this.generateToken(updatedUser);
      return {
        user: updatedUser,
        token: jwt,
      };
    } catch (err) {
      this.logger.error(err);
      throw err;
    }
  }

  public async GetResetEmail(email: string) {
    try {
      const user = await this.userModel.get({ email }, { first: true });
      if (!user) throw createError(404, 'Email not found');

      const resetItem = await this.resetModel.get(
        { userId: user.id },
        { first: true }
      );

      await this.db.transaction(async () => {
        if (resetItem) {
          const timeSinceLastRequest =
            Date.now() - resetItem.createdAt.getTime();
          if (timeSinceLastRequest < 600000) {
            throw createError(429, 'Cannot get another code so soon');
          } else {
            // Able to generate another code, so delete the old one
            await this.resetModel.update(resetItem.id, { completed: true });
          }
        }

        const code = this.generateResetCode(user);
        await this.db.transaction(async () => {
          await this.resetModel.add({ code, userId: user.id });
          await this.mailer.sendPasswordResetEmail(user, code);
        });
      });
    } catch (err) {
      this.logger.error(err);
      throw err;
    }
  }

  public async ResetPasswordWithCode(
    email: string,
    password: string,
    token: string
  ) {
    try {
      const user = await this.userModel.get({ email }, { first: true });
      if (!user) throw createError(404, 'Email not found');

      const resetItem = await this.resetModel.get(
        { userId: user.id },
        { first: true }
      );
      if (!resetItem) throw createError(409, 'No password resets are active');
      if (resetItem.code !== token)
        throw createError(401, 'Invalid password reset code');
      this.logger.debug(
        `Password reset code verified for user (ID: ${user.id})`
      );

      const hashedPassword = await this.hashPassword(password);

      await this.db.transaction(async () => {
        await this.userModel.update(user.id, {
          password: hashedPassword,
          updatedAt: new Date().toUTCString(),
        });
        await this.resetModel.update(resetItem.id, { completed: true });
      });
    } catch (err) {
      this.logger.error(err);
      throw err;
    }
  }

  private generateToken(user: Omit<IUser, 'password'>) {
    this.logger.debug(`Generating JWT for user (ID: ${user.id})`);
    const daysUntilExpiry = 2;
    const today = new Date();
    const exp = new Date(today);
    exp.setDate(today.getDate() + daysUntilExpiry);

    this.logger.debug(`Signing JWT for user (ID: ${user.id})`);
    return jwt.create(
      { alg: env.JWT.ALGO },
      { exp: exp.getTime(), sub: user.id.toString(), iss: user.email },
      env.JWT.SECRET
    );
  }

  private generateValidationURL(codename: string, email: string) {
    try {
      this.logger.debug(
        `Generating email validation token for user (EMAIL: ${email})`
      );
      const token = v5.generate({
        namespace: env.UUID_NAMESPACE,
        value: codename,
      }) as string; // Cast as string since we're not passing buffer

      const urlParams = new URLSearchParams({ token, email });
      const url = env.SERVER_URL + '/auth/activation?' + urlParams.toString();

      return { url, code: token };
    } catch (err) {
      this.logger.error(err);
      throw err;
    }
  }

  private generateResetCode(user: IUser) {
    try {
      this.logger.debug(
        `Generating a new password reset code for user (ID: ${user.id})`
      );
      const resetToken = v5.generate({
        namespace: env.UUID_NAMESPACE,
        value: user.codename,
      }) as string; // Cast as string since we're not passing buffer
      this.logger.debug(`Reset code generated for user (ID: ${user.id})`);

      return resetToken;
    } catch (err) {
      this.logger.error(err);
      throw err;
    }
  }

  private async hashPassword(password: string) {
    this.logger.debug('Hashing password');
    const salt = await bcrypt.genSalt(8);
    const hashedPassword = await bcrypt.hash(password, salt);
    this.logger.debug('Password hashed');
    return hashedPassword;
  }
}

interface IAuthResponse {
  user: Omit<IUser, 'password'>;
  token: string;
}

serviceCollection.addTransient(AuthService);
