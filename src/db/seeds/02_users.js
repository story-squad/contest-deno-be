// deno-lint-ignore-file
const seedUsers = [
  {
    codename: 'A Codename',
    email: 'anemail@email.com',
    firstname: 'Firstname',
    lastname: 'Lastname',
    password: 'thisisastringyoucanteverlogin',
    isValidated: true,
    roleId: 1,
  },
  {
    codename: 'CodenameTwo',
    email: 'anemawwww@email.com',
    firstname: 'Firstname',
    lastname: 'Lastname',
    password: 'thisisastringyoucanteverloginuhoh',
    isValidated: true,
    roleId: 2,
  },
  {
    codename: 'CodenameThree',
    email: 'anemaww3@email.com',
    firstname: 'Firstname3',
    lastname: 'Lastname3',
    password: 'thisisastringyoucanteverloginuhoh',
    isValidated: true,
    roleId: 3,
  },
];

exports.seed = function (knex) {
  return knex('users').insert(seedUsers);
};
