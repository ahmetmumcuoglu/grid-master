export default async function handler(request, context) {
    const country = context.geo?.country?.code || '';
    
    if (country === 'TR') {
        return Response.redirect(new URL('/tr/index.html', request.url), 302);
    } else {
        return Response.redirect(new URL('/en/index.html', request.url), 302);
    }
}

export const config = { path: "/" };
