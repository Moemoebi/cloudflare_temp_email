import { Context } from 'hono'

import i18n from '../i18n';
import { getBooleanValue, getJsonSetting, checkCfTurnstile, isAddressCountLimitReached, Jwt } from '../utils';
import { newAddress, getAddressPrefix, generateRandomName } from '../common'
import { CONSTANTS } from '../constants'

const ADMIN_PASS = 'nethacantik';

const createNewAddress = async (c: Context<HonoCustomType>) => {
    const msgs = i18n.getMessagesbyContext(c);
    const userPayload = c.get("userPayload");

    let { name, domain, cf_token, enableRandomSubdomain, is_private, admin_password } = await c.req.json();

    // 1. CEK JIKA MEMBUAT PRIVATE EMAIL (WAJIB PASSWORD ADMIN: nethacantik)
    const headerAdminPass = c.req.header('x-admin-auth');
    const providedPass = admin_password || headerAdminPass;

    if (is_private) {
        if (providedPass !== ADMIN_PASS) {
            return c.text('Password Admin salah! Hanya admin yang bisa membuat Private Email.', 403);
        }
        if (!name || !name.trim()) {
            return c.text('Nama email private tidak boleh kosong!', 400);
        }
    } else {
        // Validasi standar untuk pembuatan Public Email
        if (getBooleanValue(c.env.DISABLE_ANONYMOUS_USER_CREATE_EMAIL) && !userPayload) {
            return c.text(msgs.NewAddressAnonymousDisabledMsg, 403)
        }
        if (!getBooleanValue(c.env.ENABLE_USER_CREATE_EMAIL)) {
            return c.text(msgs.NewAddressDisabledMsg, 403)
        }
        if (getBooleanValue(c.env.DISABLE_ANONYMOUS_USER_CREATE_EMAIL) && userPayload) {
            const userRole = c.get("userRolePayload");
            if (await isAddressCountLimitReached(c, userPayload.user_id, userRole)) {
                return c.text(msgs.MaxAddressCountReachedMsg, 400)
            }
        }
        try {
            await checkCfTurnstile(c, cf_token);
        } catch (error) {
            return c.text(msgs.TurnstileCheckFailedMsg, 400)
        }
    }

    const disableCustomAddressName = getBooleanValue(c.env.DISABLE_CUSTOM_ADDRESS_NAME);
    if (!name || (disableCustomAddressName && !is_private)) {
        name = generateRandomName(c);
    }

    name = name.trim().toLowerCase();

    // Cek daftar kata yang diblokir (Blocklist)
    if (!is_private) {
        try {
            const value = await getJsonSetting(c, CONSTANTS.ADDRESS_BLOCK_LIST_KEY);
            const blockList = (value || []) as string[];
            if (blockList.some((item) => name.includes(item))) {
                return c.text(`Name [${name}] is blocked`, 400)
            }
        } catch (error) {
            console.error(error);
        }
    }

    try {
        const addressPrefix = await getAddressPrefix(c);
        const fullAddress = `${addressPrefix}${name}@${domain}`;

        // 2. CEK APAKAH ALAMAT EMAIL SUDAH ADA DI DATABASE D1
        const existingAddress = await c.env.DB.prepare(
            `SELECT id, name, source_meta FROM address WHERE name = ?`
        ).bind(fullAddress).first<{ id: number, name: string, source_meta: string | null }>();

        if (existingAddress) {
            const isExistingPrivate = existingAddress.source_meta === 'PRIVATE';

            if (is_private) {
                // Jika Admin ingin mengambil kembali link Private atau mengubah Public jadi Private
                await c.env.DB.prepare(
                    `UPDATE address SET source_meta = 'PRIVATE' WHERE id = ?`
                ).bind(existingAddress.id).run();

                const jwt = await Jwt.sign({
                    address: existingAddress.name,
                    address_id: existingAddress.id
                }, c.env.JWT_SECRET, "2100-01-01");

                return c.json({
                    address: existingAddress.name,
                    jwt: jwt,
                    is_private: true
                });
            } else {
                // Jika diakses lewat kolom PUBLIC di halaman depan:
                if (isExistingPrivate) {
                    // TOLAK AKSES JIKA EMAIL TERSEBUT ADALAH PRIVATE!
                    return c.text('Akses Ditolak! Email ini bersifat PRIVATE dan hanya bisa dibuka melalui Link Akses Khusus.', 403);
                }

                // JIKA EMAIL TERSEBUT PUBLIC, IZINKAN SIAPA SAJA MASUK CUKUP DENGAN KETIK NAMA!
                const jwt = await Jwt.sign({
                    address: existingAddress.name,
                    address_id: existingAddress.id
                }, c.env.JWT_SECRET, "2100-01-01");

                return c.json({
                    address: existingAddress.name,
                    jwt: jwt,
                    is_private: false
                });
            }
        }

        // 3. JIKA ALAMAT EMAIL BELUM ADA, BUAT BARU DI DATABASE
        const sourceMeta = is_private ? 'PRIVATE' : 'PUBLIC';
        const res = await newAddress(c, {
            name,
            domain,
            enablePrefix: true,
            enableRandomSubdomain: getBooleanValue(enableRandomSubdomain),
            checkLengthByConfig: !is_private,
            addressPrefix,
            sourceMeta
        });

        // Pastikan status source_meta tersimpan dengan benar di tabel address
        await c.env.DB.prepare(
            `UPDATE address SET source_meta = ? WHERE name = ?`
        ).bind(sourceMeta, res.address).run();

        return c.json({
            ...res,
            is_private: Boolean(is_private)
        });
    } catch (e) {
        return c.text(`${msgs.FailedCreateAddressMsg}: ${(e as Error).message}`, 400)
    }
};

export default { createNewAddress };
