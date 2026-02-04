<!-- Markdown with HTML -->
<div align="center">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://arc0.ai/brand/logo-full-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="https://arc0.ai/brand/logo-full-light.svg">
  <img alt="Arc0" src="https://arc0.ai/brand/logo-full-light.svg" width="300">
</picture>

<p align="center"><b>Mobile app to command Claude Code running on your workstation.</b></p>
</div>

<p align="center">
  <a href='http://makeapullrequest.com'>
    <img alt='PRs Welcome' src='https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=shields'/>
  </a>
  <a href="https://opensource.org/license/MIT/">
    <img src="https://img.shields.io/github/license/amicalhq/arc0?logo=opensourceinitiative&logoColor=white&label=License&color=8A2BE2" alt="license">
  </a>
  <br>
  <a href="https://arc0.ai/community">
    <img src="https://img.shields.io/badge/discord-7289da.svg?style=flat-square&logo=discord" alt="discord" style="height: 20px;">
  </a>
</p>

<p align="center">
  <a href="https://arc0.ai">Website</a> - <a href="https://arc0.ai/docs">Docs</a> - <a href="https://arc0.ai/community">Community</a> - <a href="https://github.com/amicalhq/arc0/issues/new?assignees=&labels=bug&template=bug_report.md">Bug reports</a>
</p>

## Table of Contents

- [🔮 Overview](#-overview)
- [🚀 Getting Started](#-getting-started)
- [✨ Features](#-features)
- [🔰 Tech Stack](#-tech-stack)
- [🤗 Contributing](#-contributing)
- [🎗 License](#-license)

## 🔮 Overview

Mobile app to command coding agents running on your workstation.

> [!NOTE]
> Arc0 is in active development towards its first beta release. Expect bugs and rapidly changing features.

Arc0 connects with AI coding assistants like Claude Code running on your workstation, letting you monitor and interact with them so you can code on the go.

It's becoming increasingly clear that the future of coding involves engineers steering AI agents rather than writing every line themselves. Arc0 is your companion to help you do that from wherever you are.

Arc0 doesn't aim to replace existing AI coding assistants like Claude Code, Codex, or Gemini CLI. Instead, it's a mobile interface for them - you keep using the same powerful tools on your workstation without changing your workflow, and seamlessly continue your work on mobile without running a command or doing a handoff.

It's our daily driver, and we have a lot planned: Claude Code today, with support for others like Codex, Gemini CLI, OpenCode, and KiloCode coming soon. And a whole lot of features to make AI assisted coding on mobile a breeze.

## 🚀 Getting Started

```bash
curl -fsSL arc0.ai/install.sh | bash
```

## ✨ Features

- **Works with Your Existing Claude Code:** Connects directly to your standard Claude Code - no custom CLI or wrapper needed.
- **Approve Tools & Plans from Anywhere:** Approve tool calls and plan reviews from your phone - no need to rush back to your desk.
- **Near Real-Time Sync:** Sub-second latency lets you watch your session unfold live from anywhere and respond instantly.
- **Live Artifact Tracking:** Track artifacts like plans, task lists, and other outputs as they're produced by the agent and tool calls in real-time.
- **Native iOS & Android Apps:** Native mobile apps for iOS and Android. Also available as a PWA.
- **One-Click Secure Connection:** Built-in reverse proxy connects your devices instantly - no complex setup needed.
- **End-to-End Encryption:** Encrypted from workstation to device - no third-party servers in between.
- **Push Notifications (coming soon):** Get notified when Claude needs input - approvals and completions on your lock screen.
- **Git & Worktree Management (coming soon):** Review diffs, manage branches, and handle worktrees from mobile.

## 🔰 Tech Stack

- 🧑‍💻 [TypeScript](https://www.typescriptlang.org/)
- 📱 [Expo](https://expo.dev/) & [React Native](https://reactnative.dev/)
- 🎨 [Tailwind](https://tailwindcss.com/) & [NativeWind](https://www.nativewind.dev/)
- 🥟 [Bun](https://bun.sh/)
- 🔌 [Socket.IO](https://socket.io/)
- 🗃️ [SQLite](https://www.sqlite.org/) & [TinyBase](https://tinybase.org/)
- 🧪 [Appium](https://appium.io/) & [Playwright](https://playwright.dev/)
- 🌀 [Turborepo](https://turbo.build/)

## 🤗 Contributing

Contributions are welcome! Reach out to the team in our [Discord server](https://arc0.ai/community) to learn more.

- **🐛 [Report an Issue][issues]**: Found a bug? Let us know!
- **💬 [Start a Discussion][discussions]**: Have ideas or suggestions? We'd love to hear from you.

## 🎗 License

Released under [MIT][license].

<!-- REFERENCE LINKS -->

[license]: https://github.com/amicalhq/arc0/blob/main/LICENSE
[discussions]: https://arc0.ai/community
[issues]: https://github.com/amicalhq/arc0/issues
