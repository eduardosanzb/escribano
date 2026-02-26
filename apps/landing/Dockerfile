FROM klakegg/hugo:ext-alpine AS builder

WORKDIR /src

COPY hugo.toml ./
COPY content ./content
COPY layouts ./layouts
COPY assets ./assets
COPY static ./static

RUN hugo --gc --minify

FROM nginx:alpine

COPY --from=builder /src/public /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
