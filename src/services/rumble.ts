import {
  createError,
  Inject,
  moment,
  Service,
  serviceCollection,
  v5,
} from '../../deps.ts';
import env from '../config/env.ts';
import {
  ISection,
  ISectionPostBody,
  ISectionWithRumbles,
} from '../interfaces/cleverSections.ts';
import { Roles } from '../interfaces/roles.ts';
import {
  IRumblePostBody,
  IRumbleWithSectionInfo,
} from '../interfaces/rumbles.ts';
import { IUser } from '../interfaces/users.ts';
import CleverSectionModel from '../models/cleverSections.ts';
import CleverStudentModel from '../models/cleverStudents.ts';
import CleverTeacherModel from '../models/cleverTeachers.ts';
import RumbleModel from '../models/rumbles.ts';
import RumbleSectionsModel from '../models/rumbleSections.ts';
import BaseService from './baseService.ts';

@Service()
export default class RumbleService extends BaseService {
  constructor(
    @Inject(RumbleModel) private rumbleModel: RumbleModel,
    @Inject(CleverTeacherModel) private teacherModel: CleverTeacherModel,
    @Inject(CleverStudentModel) private studentModel: CleverStudentModel,
    @Inject(CleverSectionModel) private sectionModel: CleverSectionModel,
    @Inject(RumbleSectionsModel) private rumbleSections: RumbleSectionsModel
  ) {
    super();
  }

  public async getSections(user: IUser) {
    try {
      this.logger.debug(`Getting sections for user ${user.id}`);

      let sections: ISection[];
      if (user.roleId === Roles.teacher) {
        sections = await this.teacherModel.getSectionsById(user.id);
      } else if (user.roleId === Roles.user) {
        sections = await this.studentModel.getSectionsById(user.id);
      } else {
        throw createError(401, 'Invalid user type!');
      }

      await this.getActiveRumblesForSections(sections as ISectionWithRumbles[]);

      return sections;
    } catch (err) {
      this.logger.error(err);
      throw err;
    }
  }

  public async getActiveRumblesForSections(sections: ISectionWithRumbles[]) {
    try {
      for await (const section of sections) {
        const rumbleArray = await this.rumbleModel.getActiveRumblesBySectionId(
          section.id
        );
        section.rumbles = rumbleArray;
      }
    } catch (err) {
      this.logger.error(err);
      throw err;
    }
  }

  public async createSection(body: ISectionPostBody, teacherId: number) {
    try {
      this.logger.debug(
        `Attempting to add section '${body.name}' for teacher with id ${teacherId}`
      );

      let section: ISection | undefined;
      await this.db.transaction(async () => {
        const joinCode = this.generateJoinCode(body.name);
        // Transactions mantain data integrity when creaing multiple rows
        const [res] = await this.sectionModel.add({
          joinCode,
          active: true,
          gradeId: body.gradeId,
          name: body.name,
          subjectId: body.subjectId,
        });

        await this.teacherModel.add({
          primary: true,
          sectionId: res.id,
          userId: teacherId,
        });

        section = res;
      });
      if (section) return section;
      else throw createError(400, 'Could not create section');
    } catch (err) {
      this.logger.error(err);
      throw err;
    }
  }

  public async addChildToSection(
    joinCode: string,
    sectionId: number,
    studentId: number
  ): Promise<ISectionWithRumbles> {
    try {
      // Get the section with the given id
      const section = await this.sectionModel.get(
        { id: sectionId },
        { first: true }
      );
      // Handle nonexistent section
      if (!section) {
        throw createError(404, 'Invalid section ID');
      }
      // Handle incorrect join code
      if (joinCode !== section.joinCode) {
        throw createError(401, 'Join code is invalid');
      }

      // Connect the student user to the section
      await this.studentModel.add({
        sectionId: section.id,
        userId: studentId,
      });

      const rumbles = await this.rumbleModel.getActiveRumblesBySectionId(
        sectionId
      );

      return { ...section, rumbles };
    } catch (err) {
      this.logger.error(err);
      throw err;
    }
  }

  public async createGameInstances(
    body: IRumblePostBody,
    sectionIds: number[]
  ): Promise<IRumbleWithSectionInfo[]> {
    try {
      const rumbles: IRumbleWithSectionInfo[] = [];
      await this.db.transaction(async () => {
        for await (const sectionId of sectionIds) {
          const joinCode = this.generateJoinCode(
            `${body.numMinutes}-${body.promptId}`
          );

          const [res] = await this.rumbleModel.add({
            joinCode,
            canJoin: false,
            maxSections: 1,
            numMinutes: body.numMinutes,
            promptId: body.promptId,
          });

          await this.rumbleSections.add({
            rumbleId: res.id,
            sectionId,
          });

          const [{ name }] = await this.sectionModel.get({ id: sectionId });

          rumbles.push({ ...res, sectionName: name, sectionId });
        }
        // if (rumbles.length !== sections.length)
        //   throw createError(409, 'Unable to create rumbles');
      });
      return rumbles;
    } catch (err) {
      this.logger.error(err);
      throw err;
    }
  }

  public async startRumble(sectionId: number, rumbleId: number) {
    try {
      // Get the rumble based off of the ID to know the desired game length
      const rumble = await this.rumbleModel.get(
        { id: rumbleId },
        { first: true }
      );

      // Calculate the end time from the game length
      const endTime = this.calculateEndTime(rumble.numMinutes);

      // Update the end time of the given rumble
      await this.rumbleSections.updateEndTime(endTime, sectionId, rumbleId);

      // Return the end time to the user
      return endTime;
    } catch (err) {
      this.logger.error(err);
      throw err;
    }
  }

  private generateJoinCode(key: string) {
    try {
      this.logger.debug(`Generating join code with key: '${key}'`);

      const joinCode = v5.generate({
        namespace: env.UUID_NAMESPACE,
        value: `${key}-${Date.now()}`,
      }) as string;

      this.logger.debug(`Join code generated for key: '${key}'`);

      return joinCode;
    } catch (err) {
      this.logger.error(err);
      throw err;
    }
  }

  private calculateEndTime(numMinutes: number): Date {
    return (moment.utc().add(numMinutes, 'm') as unknown) as Date;
  }
}

serviceCollection.addTransient(RumbleService);
