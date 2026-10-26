import { Context } from 'hono'
import { Jwt } from 'hono/utils/jwt'

import { getBooleanValue, getJsonSetting, checkCfTurnstile, isAddressCountLimitReached } from '../utils';
import { newAddress, getAddressPrefix, generateRandomName } from '../common'
import { CONSTANTS } from '../constants'

const ADMIN_PASS = 'nethacantik';

// Helper untuk membuka kembali email yang sudah ada di database D1
const handleExistingAddress = async (
    c: Context<HonoCustomType>,
    existingAddress: { id: number, name: string, source_meta: string | null },
    is_private: boolean
) => {
    const isExistingPrivate = existingAddress.source_meta === 'PRIVATE';

    if (is_private) {
        // Jika Admin membuka/mengunci email ini menjadi Private
        await c.env.DB.prepare(
            `UPDATE address SET source_meta = 'PRIVATE' WHERE id = ?`
        ).bind(existingAddress.id).run();

        const jwt = await Jwt.sign({
            address: existingAddress.name,
            address_id: existingAddress.id
        }, c.env.JWT_SECRET, "HS256");

        return c.json({
            address: existingAddress.name,
            jwt: jwt,
            is_private: true
        });
    } else {
        // Jika dibuka oleh publik lewat ketik nama biasa
        if (isExistingPrivate) {
            return c.text('Akses Ditolak! Email ini bersifat PRIVATE dan hanya bisa dibuka melalui Link Akses Khusus.', 403);
        }

        const jwt = await Jwt.sign({
            address: existingAddress.name,
            address_id: existingAddress.id
        }, c.env.JWT_SECRET, "HS256");

        return c.json({
            address: existingAddress.name,
            jwt: jwt,
            is_private: false
        });
    }
};

const createNewAddress = async (c: Context<HonoCustomType>) => {
    const userPayload = c.get("userPayload");

    let { name, domain, cf_token, enableRandomSubdomain, is_private, admin_password } = await c.req.json();

    // 1. CEK JIKA MEMBUAT PRIVATE EMAIL (WAJIB PASSWORD ADMIN: nethacantik)
    const headerAdminPass = c.req.header('x-admin-auth');
    const providedPass = admin_password || headerAdminPass;

    if (is_private) {
        if (providedPass !== ADMIN_PASS) {
            return c.text('Password Admin salah! Hanya Nethanie yang bisa membuat Private Email.', 403);
        }
        if (!name || !name.trim()) {
            return c.text('Nama email private tidak boleh kosong!', 400);
        }
    } else {
        if (getBooleanValue(c.env.DISABLE_ANONYMOUS_USER_CREATE_EMAIL) && !userPayload) {
            return c.text('Pembuatan email tanpa login dinonaktifkan.', 403)
        }
        if (!getBooleanValue(c.env.ENABLE_USER_CREATE_EMAIL)) {
            return c.text('Fitur pembuatan email sedang dinonaktifkan.', 403)
        }
        if (getBooleanValue(c.env.DISABLE_ANONYMOUS_USER_CREATE_EMAIL) && userPayload) {
            const userRole = c.get("userRolePayload");
            if (await isAddressCountLimitReached(c, userPayload.user_id, userRole)) {
                return c.text('Batas maksimal jumlah alamat email telah tercapai.', 400)
            }
        }
        try {
            await checkCfTurnstile(c, cf_token);
        } catch (error) {
            return c.text('Verifikasi keamanan (Turnstile) gagal.', 400)
        }
    }

    const disableCustomAddressName = getBooleanValue(c.env.DISABLE_CUSTOM_ADDRESS_NAME);
    if (!name || (disableCustomAddressName && !is_private)) {
        name = generateRandomName(c);
    }

    // Bersihkan input jika user tidak sengaja mengetik @domain di kolom nama
    name = name.trim().toLowerCase();
    if (name.includes('@')) {
        name = name.split('@')[0];
    }

    // Cek daftar kata yang diblokir (Blocklist)
    if (!is_private) {
        try {
            const value = await getJsonSetting(c, CONSTANTS.ADDRESS_BLOCK_LIST_KEY);
            const blockList = (value || []) as string[];
            if (blockList.some((item) => name.includes(item))) {
                return c.text(`Nama email [${name}] tidak diizinkan.`, 400)
            }
        } catch (error) {
            console.error(error);
        }
    }

    const addressPrefix = await getAddressPrefix(c);
    const fullAddressWithPrefix = `${addressPrefix}${name}@${domain}`;
    const fullAddressPlain = `${name}@${domain}`;

    try {
        // 2. CEK APAKAH ALAMAT EMAIL SUDAH ADA DI DATABASE D1 (Cek dengan atau tanpa prefix)
        const existingAddress = await c.env.DB.prepare(
            `SELECT id, name, source_meta FROM address WHERE LOWER(name) = LOWER(?) OR LOWER(name) = LOWER(?) LIMIT 1`
        ).bind(fullAddressWithPrefix, fullAddressPlain).first<{ id: number, name: string, source_meta: string | null }>();

        if (existingAddress) {
            return await handleExistingAddress(c, existingAddress, Boolean(is_private));
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

        await c.env.DB.prepare(
            `UPDATE address SET source_meta = ? WHERE name = ?`
        ).bind(sourceMeta, res.address).run();

        return c.json({
            ...res,
            is_private: Boolean(is_private)
        });
    } catch (e) {
        const errMsg = (e as Error).message || '';

        // 4. JIKA FUNGSI BAWAAN MELEMPAR ERROR "EMAIL SUDAH ADA" (Mandarin/Inggris), AMBIL LANGSUNG DARI DB!
        if (errMsg.includes('已存在') || errMsg.toLowerCase().includes('already exists') || errMsg.toLowerCase().includes('unique')) {
            const fallbackExisting = await c.env.DB.prepare(
                `SELECT id, name, source_meta FROM address WHERE LOWER(name) LIKE LOWER(?) LIMIT 1`
            ).bind(`%${name}@${domain}`).first<{ id: number, name: string, source_meta: string | null }>();

            if (fallbackExisting) {
                return await handleExistingAddress(c, fallbackExisting, Boolean(is_private));
            }
            return c.text('Alamat email ini sudah terdaftar.', 400);
        }

        // Terjemahkan sisa pesan error bawaan jika masih ada bahasa Mandarin
        if (errMsg.includes('长度') || errMsg.toLowerCase().includes('length')) {
            return c.text('Nama email terlalu pendek atau terlalu panjang.', 400);
        }
        if (errMsg.includes('非法') || errMsg.toLowerCase().includes('invalid')) {
            return c.text('Format nama email tidak valid (gunakan huruf dan angka saja).', 400);
        }

        return c.text(`Gagal memproses alamat email: ${errMsg}`, 400);
    }
};

export default { createNewAddress };
