describe('Basic Jest Test', () => {
  it('should run a simple test', () => {
    expect(1 + 1).toBe(2);
  });

  it('should test that Node.js is working', () => {
    expect(process.version).toBeDefined();
  });

  it('should be able to require a built-in module', () => {
    const fs = require('fs');
    expect(typeof fs.readFileSync).toBe('function');
  });
});
