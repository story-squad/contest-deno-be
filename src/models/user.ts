import {
  Join,
  Where,
  Service,
  serviceCollection,
  Query,
  Client,
  log,
  Inject,
  createError,
  bcrypt,
} from '../../deps.ts';
import { IUser, IUserSignup } from '../interfaces/user.ts';
import PGModel from './pgModel.ts';

@Service()
export default class UserModel extends PGModel {
  constructor(
    @Inject('pg') protected dbConnect: Client,
    @Inject('logger') protected logger: log.Logger
  ) {
    super();
  }
  public async add(body: IUserSignup): Promise<{ id: number }> {
    try {
      this.logger.debug(
        `Attempting to add user (EMAIL: ${body.email}) to database`
      );

      const builder = new Query();
      const sql = builder.table('users').insert(body).build();

      // Our querybuilder needs some parsing to get valid PGSQL
      const sqlWithReturn = sql + 'RETURNING id';
      const result = await this.dbConnect.query(this.parseSql(sqlWithReturn));

      // Use the parser function to generate proper data
      const { id } = (this.parseResponse(result, {
        first: true,
      }) as unknown) as { id: number };

      this.logger.debug(`Created new user (ID: ${id}, EMAIL: ${body.email})`);
      return { id };
    } catch (err) {
      this.logger.error(err);
      throw err;
    }
  }

  public async update(id: number, changes: Partial<IUser>) {
    try {
      this.logger.debug(
        `Updating user (ID: ${id}) with changes: ${JSON.stringify(changes)}`
      );

      // Generate query to mark user as validated
      const builder = new Query();
      const sql = builder
        .table('users')
        .where(Where.field('id').eq(id))
        .update(changes)
        .build();
      const sqlWithReturn = sql + ' RETURNING *';

      // Parse and run the query
      const response = await this.dbConnect.query(this.parseSql(sqlWithReturn));
      if (response.rowCount === 0) {
        // If no rows were changed, user was not validated
        throw createError(409, 'Unable to update user');
      }

      // Parse the user out of the response
      const user = (this.parseResponse(response, {
        first: true,
      }) as unknown) as IUser;
      this.logger.debug(`User (ID: ${id}) successfully updated`);

      return user;
    } catch (err) {
      this.logger.error(err);
      throw err;
    }
  }

  public async findOne(filter: { [key: string]: unknown }): Promise<IUser> {
    try {
      const queryField = Object.keys(filter)[0];

      const builder = new Query();
      const sql = builder
        .table('users')
        .where(Where.field(queryField).eq(filter[queryField]))
        .select('*')
        .build();

      const result = await this.dbConnect.query(this.parseSql(sql));
      const user = (this.parseResponse(result, {
        first: true,
      }) as unknown) as IUser;

      return user;
    } catch (err) {
      this.logger.error(err);
      throw err;
    }
  }

  public async isAdmin(id: number) {
    try {
      const builder = new Query();
      const sql = builder
        .table('users')
        .join(Join.inner('roles').on('roles.id', 'users.roleId'))
        .where(Where.field('users.id').eq(id))
        .select('roles.role')
        .build();

      const result = await this.dbConnect.query(this.parseSql(sql));
      if (!result.rowCount || result.rowCount === 0) {
        throw new Error(`User (ID: ${id}) not found!`);
      }
      const res = this.parseResponse(result, { first: true }) as {
        role: string;
      };
      const isAdmin = res.role === 'admin';

      // Will log a warning if someone who is not an admin attempts to access admin resource
      if (isAdmin)
        this.logger.debug(`Admin (ID: ${id}) accessed admin resources`);
      else
        this.logger.warning(
          `User (ID: ${id}) attempted to access admin resources`
        );
      return isAdmin;
    } catch (err) {
      this.logger.error(err);
      throw err;
    }
  }

  public async setUserHasBeenValidated(id: number) {
    try {
      this.logger.debug(`Marking user (ID: ${id}) isValidated as true`);

      // Generate query to mark user as validated
      const builder = new Query();
      const sql = builder
        .table('users')
        .where(Where.field('id').eq(id))
        .update({ isValidated: true })
        .build();
      const sqlWithReturn = sql + ' RETURNING *';

      // Parse and run the query
      const response = await this.dbConnect.query(this.parseSql(sqlWithReturn));
      if (response.rowCount === 0) {
        // If no rows were changed, user was not validated
        throw createError(409, 'Unable to validate user');
      }

      // Parse the user out of the response
      const user = (this.parseResponse(response, {
        first: true,
      }) as unknown) as IUser;
      this.logger.debug(`User (ID: ${id}) has successfully validated`);

      return user;
    } catch (err) {
      this.logger.error(err);
      throw err;
    }
  }

  public async hashPassword(password: string) {
    this.logger.debug('Hashing password');
    const salt = await bcrypt.genSalt(8);
    const hashedPassword = await bcrypt.hash(password, salt);
    this.logger.debug('Password hashed');
    return hashedPassword;
  }
}

serviceCollection.addTransient(UserModel);
