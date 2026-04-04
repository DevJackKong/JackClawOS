# EAR 加密出口合规文件

## 背景

JackClaw 使用 RSA-4096 + AES-256-GCM 端到端加密通信。根据美国《出口管理条例》(EAR) Part 742.15(b)，公开可获取的加密源代码（如 GitHub 开源项目）适用 ECCN 5D002 分类，但可通过 License Exception TSU (Technology and Software Unrestricted) 豁免出口许可。

**前提条件：**
1. 源代码公开可获取（GitHub 公开仓库 ✅）
2. 在源代码公开时或公开后，通知 BIS 和 NSA
3. 通知内容包含项目 URL

---

## 文件一：BIS/NSA 通知邮件

**收件人：**
- BIS (Bureau of Industry and Security): `crypt@bis.doc.gov`
- NSA (National Security Agency): `enc@nsa.gov`

**主题：** TSU Notification – Section 742.15(b) – JackClawOS Open Source Encryption

**正文：**

```
To: crypt@bis.doc.gov, enc@nsa.gov
Subject: TSU Notification – Section 742.15(b) – JackClawOS Open Source Encryption

SUBMISSION TYPE: TSU NOTIFICATION
SUBMITTED BY: Mack Ding
SUBMITTED FOR: JackClawOS (Open Source Project)

This is a notification pursuant to Section 742.15(b) of the Export 
Administration Regulations (EAR) regarding the public availability 
of encryption source code.

PROJECT NAME: JackClawOS
PROJECT URL: https://github.com/DevJackKong/JackClawOS
LICENSE: MIT

ENCRYPTION FUNCTIONALITY:
- RSA-4096 asymmetric encryption (key exchange)
- AES-256-GCM symmetric encryption (message content)
- JWT (HS256) for authentication tokens
- HMAC-SHA256 for message integrity verification
- VAPID (Web Push) key generation

ECCN: 5D002
LICENSE EXCEPTION: TSU (Technology and Software - Unrestricted)

PURPOSE:
JackClawOS is an open-source multi-agent collaboration framework 
that provides end-to-end encrypted communication between AI agents. 
The encryption is used to protect inter-agent messages and is 
implemented using standard Node.js crypto module APIs.

The complete source code is publicly available and freely downloadable 
at the URL listed above under the MIT open-source license.

This notification is provided in accordance with 15 CFR § 742.15(b) 
and EAR § 740.13(e).

Respectfully,

Mack Ding
JackClawOS Project Maintainer
GitHub: https://github.com/DevJackKong
Email: JackClaw@jackclaw.ai
Date: April 4, 2026
```

---

## 文件二：发送步骤

1. 复制上述邮件内容
2. 同时发送到两个地址：`crypt@bis.doc.gov` 和 `enc@nsa.gov`
3. 保留发送记录（截图或存档发件箱）
4. 建议用项目相关邮箱发送（如 JackClaw@jackclaw.ai）
5. 无需等待回复——这是单向通知，不是审批

**注意：** 每次加密功能有重大变更时（如更换加密算法），建议重新通知。

---

## 参考法规

- EAR Part 742.15(b): 加密软件出口管制
- EAR Part 740.13(e): TSU 豁免条件
- ECCN 5D002: 加密软件分类
- 15 CFR § 734.7: 公开可获取技术定义
