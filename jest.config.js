const { pathsToModuleNameMapper } = require('ts-jest');
const { compilerOptions } = require('./tsconfig.base.json');

const moduleNameMapper = pathsToModuleNameMapper(compilerOptions.paths, {
  prefix: '<rootDir>',
});

module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.spec.ts'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.base.json',
        isolatedModules: true,
      },
    ],
  },
  moduleNameMapper: {
    ...moduleNameMapper,
    '^file-type$': '<rootDir>/tests/stubs/file-type.js',
  },
  setupFiles: ['<rootDir>/tests/setup.env.js'],
};
