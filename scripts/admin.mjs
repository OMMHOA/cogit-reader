#!/usr/bin/env node
// Accounts for the proofreading site. Only members (app_metadata.member) can use it.
//
//   node scripts/admin.mjs add <email> "<name>" [password]   new member; prints the password
//   node scripts/admin.mjs password <email> [password]       new password; prints it
//   node scripts/admin.mjs rename <email> "<name>"
//   node scripts/admin.mjs remove <email>                    takes away access (keeps their comments)
//   node scripts/admin.mjs list
import { randomInt } from "node:crypto";
import { adminClient, die } from "./env.mjs";

const sb = adminClient();
const [cmd, email, ...rest] = process.argv.slice(2);

// Easy to read out over the phone: three groups of four, no look-alike characters.
function newPassword() {
  const abc = "abcdefghjkmnpqrstuvwxyz23456789";
  const group = () => Array.from({ length: 4 }, () => abc[randomInt(abc.length)]).join("");
  return `${group()}-${group()}-${group()}`;
}

async function findUser(address) {
  for (let page = 1; ; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) die(error.message);
    const hit = data.users.find((u) => u.email?.toLowerCase() === address.toLowerCase());
    if (hit) return hit;
    if (data.users.length < 1000) die(`No user ${address}.`);
  }
}

if (cmd === "add") {
  const [name, given] = rest;
  if (!email || !name) die('Usage: add <email> "<name>" [password]');
  const password = given || newPassword();
  const { error } = await sb.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name },
    app_metadata: { member: true },
  });
  if (error) die(error.message);
  console.log(`Added ${name} <${email}>\nPassword: ${password}`);
} else if (cmd === "password") {
  const user = await findUser(email);
  const password = rest[0] || newPassword();
  const { error } = await sb.auth.admin.updateUserById(user.id, { password });
  if (error) die(error.message);
  console.log(`New password for ${email}: ${password}`);
} else if (cmd === "rename") {
  const user = await findUser(email);
  const { error } = await sb.auth.admin.updateUserById(user.id, {
    user_metadata: { ...user.user_metadata, name: rest[0] },
  });
  if (error) die(error.message);
  console.log(`Renamed ${email} to ${rest[0]}`);
} else if (cmd === "remove") {
  const user = await findUser(email);
  const { error } = await sb.auth.admin.updateUserById(user.id, {
    app_metadata: { ...user.app_metadata, member: false },
  });
  if (error) die(error.message);
  console.log(`${email} no longer has access (within the hour, when their session expires).`);
} else if (cmd === "list") {
  const { data, error } = await sb.auth.admin.listUsers({ perPage: 1000 });
  if (error) die(error.message);
  for (const u of data.users)
    console.log(
      `${u.app_metadata?.member ? "member " : "no access"}  ${u.email}  ${u.user_metadata?.name ?? ""}  last sign-in: ${u.last_sign_in_at?.slice(0, 16) ?? "never"}`,
    );
} else {
  die("Commands: add, password, rename, remove, list (see the top of this file).");
}
