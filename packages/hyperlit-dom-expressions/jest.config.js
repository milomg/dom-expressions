module.exports = {
  collectCoverageFrom: [
    'dist/hyperlit-dom-expressions.js'
  ],
  transformIgnorePatterns: [
    "node_modules/(?!(dom-expressions)/)"
  ]
}