export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Allowed types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert
    'subject-case': [0], // allow any casing in the subject
    'header-max-length': [2, 'always', 100],
    'body-max-line-length': [0],
  },
};
