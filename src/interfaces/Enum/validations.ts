import { IUser } from '../users';

export interface IValidation extends INewValidation {
  id: number;
  created_at: Date;
  completed_at?: Date;
}

export interface INewValidation {
  code: string;
  email: string;
  userId: number;
  validatorId: ValidatorEnum & number;
}

export enum ValidatorEnum {
  user = 1,
  parent = 2,
}

export interface IGetNewValidationBody {
  newEmail: string;
  age: number;
  user: IUser;
}