# freeCar

דף הרשמה והתחברות עם **Google** באמצעות [Supabase Auth](https://supabase.com/auth).

## מבנה

- `index.html` — דף ההתחברות. כפתור "המשך עם Google", ולאחר התחברות מוצלחת הפניה אוטומטית לאזור האישי.
- `dashboard.html` — אזור אישי: הצגת שם/אימייל/תמונה מ-Google והשלמת פרטים (טלפון, תפקיד) הנשמרים ב-DB.

## בסיס נתונים (Supabase)

טבלת `public.profiles` עם RLS, מקושרת ל-`auth.users`. Trigger מכניס אוטומטית כל משתמש חדש בעת הרשמה. שדות: `email`, `full_name`, `avatar_url`, `phone`, `role`.

## הרצה מקומית

```bash
python -m http.server 3000
```

ואז לפתוח את http://localhost:3000

## הגדרה (חד-פעמי)

1. **Google Cloud** — ליצור OAuth Client (Web) עם redirect URI:
   `https://<PROJECT_REF>.supabase.co/auth/v1/callback`
2. **Supabase → Authentication → Providers → Google** — להפעיל ולהזין Client ID + Secret.
3. **Supabase → Authentication → URL Configuration** — להוסיף את כתובת הדף (למשל `http://localhost:3000/**`) ל-Redirect URLs.

> מפתח ה-`publishable`/`anon` בקוד הוא ציבורי בכוונה — הגישה לנתונים מוגנת באמצעות RLS.
