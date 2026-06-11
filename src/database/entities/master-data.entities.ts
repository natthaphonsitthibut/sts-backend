import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'risk_factors' })
export class RiskFactorEntity {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @Column({ name: 'label', type: 'text' })
  label!: string;
}

@Entity({ name: 'dropout_reasons' })
export class DropoutReasonEntity {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @Column({ name: 'label', type: 'text' })
  label!: string;
}

@Entity({ name: 'assistance_measures' })
export class AssistanceMeasureEntity {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @Column({ name: 'label', type: 'text' })
  label!: string;
}

@Entity({ name: 'related_agencies' })
export class RelatedAgencyEntity {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @Column({ name: 'name', type: 'text' })
  name!: string;
}

@Entity({ name: 'educational_areas' })
export class EducationalAreaEntity {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @Column({ name: 'name', type: 'text' })
  name!: string;
}
