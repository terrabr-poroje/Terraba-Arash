# Terrabar private Dropbox video-analysis lab

## Scope and safety
- This lab lives on the isolated `media-processing-lab` branch.
- It never deploys a Cloudflare Worker, changes DNS, touches the live domain, or reads/writes D1, Supabase, members, orders, or load records.
- It does not modify or move the original Dropbox video.
- It rejects output folders inside `/TERRABAR – Media Center` and checks that the chosen output folder is not a shared folder.
- No video, frame, token, or other binary is committed to GitHub or uploaded as a GitHub Actions artifact.
- Temporary working files are removed when the job finishes.

## How it works
1. A manually triggered lab workflow receives the exact Dropbox source path and an existing private output-folder path.
2. It exchanges a Dropbox refresh token for a short-lived access token.
3. It downloads the video to an ephemeral GitHub-hosted runner.
4. FFprobe reads duration, size, codec and dimensions. FFmpeg extracts six evenly spaced frames and builds a contact sheet.
5. Only the contact sheet and a metadata JSON are uploaded to the explicitly selected private Dropbox folder.
6. The runner deletes its temporary copy of the original video and extracted frames.

## Required Dropbox app
Create a Dropbox API app with **Full Dropbox** access and only these scopes:
- `files.metadata.read`
- `files.content.read`
- `files.content.write`

Enable OAuth code flow with offline access and generate a refresh token for the Terrabar Dropbox account. Do not paste tokens into chat or commit them to GitHub.

Add these repository Actions secrets:
- `DROPBOX_APP_KEY`
- `DROPBOX_APP_SECRET`
- `DROPBOX_REFRESH_TOKEN`

## Required private output folder
The workflow intentionally does not create folders. First create a private folder outside the shared media center, for example:
`/TERRABAR – Private Media Analysis`

Do not use a folder that is shared with members or has an anyone-with-the-link setting. The workflow checks Dropbox metadata and rejects shared folders.

## Current test target
`/TERRABAR – Media Center/00 – Upload Inbox/Amir ghofrani - IMG_8251.mov`

## Triggering
The workflow is restricted to `media-processing-lab`. The push trigger listens only for the explicit marker file `.media-lab-run`; ordinary code commits do not start a job. The manual trigger also checks the branch name. No production deployment workflow is called.
