const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Role = require('./Role')(sequelize, DataTypes);
const User = require('./User')(sequelize, DataTypes);
const HeroSlide = require('./HeroSlide')(sequelize, DataTypes);
const AuditLog = require('./AuditLog')(sequelize, DataTypes);
const SiteSetting = require('./SiteSetting')(sequelize, DataTypes);
const Program = require('./Program')(sequelize, DataTypes);
const Cohort = require('./Cohort')(sequelize, DataTypes);
const ProgramStaff = require('./ProgramStaff')(sequelize, DataTypes);
const QuizQuestion = require('./QuizQuestion')(sequelize, DataTypes);
const Application = require('./Application')(sequelize, DataTypes);
const Enrollment = require('./Enrollment')(sequelize, DataTypes);
const Payment = require('./Payment')(sequelize, DataTypes);
const Session = require('./Session')(sequelize, DataTypes);
const Attendance = require('./Attendance')(sequelize, DataTypes);
const Task = require('./Task')(sequelize, DataTypes);
const Recording = require('./Recording')(sequelize, DataTypes);
const RecordingView = require('./RecordingView')(sequelize, DataTypes);
const Certificate = require('./Certificate')(sequelize, DataTypes);

Role.hasMany(User, { foreignKey: 'roleId' });
User.belongsTo(Role, { foreignKey: 'roleId' });

AuditLog.belongsTo(User, { as: 'actor', foreignKey: 'actorId', constraints: false });
AuditLog.belongsTo(User, { as: 'onBehalfOf', foreignKey: 'onBehalfOfId', constraints: false });

Program.hasMany(Cohort, { foreignKey: 'programId' });
Cohort.belongsTo(Program, { foreignKey: 'programId' });

Program.hasMany(ProgramStaff, { foreignKey: 'programId', as: 'staff' });
ProgramStaff.belongsTo(Program, { foreignKey: 'programId' });
ProgramStaff.belongsTo(User, { foreignKey: 'userId' });
ProgramStaff.belongsTo(Role, { foreignKey: 'roleId' });

Program.hasMany(QuizQuestion, { foreignKey: 'programId' });
QuizQuestion.belongsTo(Program, { foreignKey: 'programId' });

Cohort.hasMany(Application, { foreignKey: 'cohortId' });
Application.belongsTo(Cohort, { foreignKey: 'cohortId' });
User.hasMany(Application, { foreignKey: 'userId' });
Application.belongsTo(User, { foreignKey: 'userId' });

Cohort.hasMany(Enrollment, { foreignKey: 'cohortId' });
Enrollment.belongsTo(Cohort, { foreignKey: 'cohortId' });
User.hasMany(Enrollment, { foreignKey: 'userId' });
Enrollment.belongsTo(User, { foreignKey: 'userId' });

Cohort.hasMany(Payment, { foreignKey: 'cohortId' });
Payment.belongsTo(Cohort, { foreignKey: 'cohortId' });
Payment.belongsTo(User, { foreignKey: 'userId' });

Cohort.hasMany(Session, { foreignKey: 'cohortId' });
Session.belongsTo(Cohort, { foreignKey: 'cohortId' });
Session.belongsTo(User, { as: 'lead', foreignKey: 'leadId', constraints: false });
Session.hasMany(Attendance, { foreignKey: 'sessionId' });
Attendance.belongsTo(Session, { foreignKey: 'sessionId' });
Attendance.belongsTo(User, { foreignKey: 'userId' });
User.hasMany(Attendance, { foreignKey: 'userId' });

Task.belongsTo(Program, { foreignKey: 'programId' });
Task.belongsTo(Cohort, { foreignKey: 'cohortId', constraints: false });

Cohort.hasMany(Recording, { foreignKey: 'cohortId' });
Recording.belongsTo(Cohort, { foreignKey: 'cohortId' });
Recording.belongsTo(Session, { as: 'session', foreignKey: 'sessionId', constraints: false });
Recording.hasMany(RecordingView, { foreignKey: 'recordingId' });
RecordingView.belongsTo(Recording, { foreignKey: 'recordingId' });
RecordingView.belongsTo(User, { foreignKey: 'userId' });

Certificate.belongsTo(User, { foreignKey: 'userId' });
Certificate.belongsTo(Cohort, { foreignKey: 'cohortId' });
User.hasMany(Certificate, { foreignKey: 'userId' });
Cohort.hasMany(Certificate, { foreignKey: 'cohortId' });

module.exports = { sequelize, Role, User, HeroSlide, AuditLog, SiteSetting, Program, Cohort, ProgramStaff, QuizQuestion, Application, Enrollment, Payment, Session, Attendance, Task, Recording, RecordingView, Certificate };
