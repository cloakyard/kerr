# Contributing to KERR

Contributions are welcome! Here's how to get started:

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/amazing-feature`)
3. **Commit** your changes (`git commit -m 'Add amazing feature'`)
4. **Push** to the branch (`git push origin feature/amazing-feature`)
5. **Open** a Pull Request

Run `npm run check` before pushing. The shaders live in template literals, so a
stray backtick in a GLSL comment terminates the string and the page dies at
load — the check catches that and verifies the pinned three.js build.
