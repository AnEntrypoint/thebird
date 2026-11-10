#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <string>
#include <string_view>

#include "gm/json.hpp"
#include "gm/mcp.hpp"
#include "internal.hpp"

namespace gm::mcp::detail {

std::size_t js_length(std::string_view text) {
    std::size_t units = 0;
    for (std::size_t i = 0; i < text.size(); ++i) {
        ++units;
        const unsigned char c = static_cast<unsigned char>(text[i]);
        if (c >= 0xf0 && i + 3 < text.size()) i += 3;
        else if (c >= 0xe0 && i + 2 < text.size()) i += 2;
        else if (c >= 0xc0 && i + 1 < text.size()) i += 1;
    }
    return units;
}

std::string js_prefix(std::string_view text, std::size_t units) {
    std::size_t seen = 0;
    std::size_t bytes = 0;
    while (bytes < text.size() && seen < units) {
        const unsigned char c = static_cast<unsigned char>(text[bytes]);
        std::size_t width = 1;
        if (c >= 0xf0 && bytes + 3 < text.size()) width = 4;
        else if (c >= 0xe0 && bytes + 2 < text.size()) width = 3;
        else if (c >= 0xc0 && bytes + 1 < text.size()) width = 2;
        bytes += width;
        ++seen;
    }
    return std::string(text.substr(0, bytes));
}

}

namespace {

char* out_buffer = nullptr;
std::size_t out_length = 0;

void set_out(std::string text) {
    if (out_buffer != nullptr) std::free(out_buffer);
    out_length = text.size();
    out_buffer = static_cast<char*>(std::malloc(out_length + 1));
    if (out_buffer != nullptr) {
        std::memcpy(out_buffer, text.data(), out_length);
        out_buffer[out_length] = '\0';
    }
}

std::string_view in_at(const char* ptr, std::int32_t len) {
    return len > 0 && ptr != nullptr ? std::string_view(ptr, static_cast<std::size_t>(len)) : std::string_view{};
}

}

extern "C" {

__attribute__((export_name("gm_alloc")))
void* gm_alloc(std::int32_t size) {
    return std::malloc(static_cast<std::size_t>(size < 0 ? 0 : size));
}

__attribute__((export_name("gm_free")))
void gm_free(void* ptr) {
    std::free(ptr);
}

__attribute__((export_name("gm_json_len")))
std::int32_t gm_json_len() {
    return static_cast<std::int32_t>(out_length);
}

__attribute__((export_name("gm_json_out")))
char* gm_json_out() {
    return out_buffer;
}

__attribute__((export_name("gm_json_normalize")))
std::int32_t gm_json_normalize(const char* ptr, std::int32_t len) {
    const auto parsed = gm::json::parse(in_at(ptr, len));
    if (!parsed) {
        set_out(std::string("{\"gmError\":") + gm::json::quote(parsed.error()) + "}");
        return 1;
    }
    set_out(gm::json::dump(*parsed));
    return 0;
}

__attribute__((export_name("gm_sha256_hex")))
std::int32_t gm_sha256_hex(const char* ptr, std::int32_t len) {
    set_out(gm::mcp::sha256_hex(in_at(ptr, len)));
    return 0;
}

__attribute__((export_name("gm_clip")))
std::int32_t gm_clip(const char* ptr, std::int32_t len, std::int32_t cap) {
    set_out(gm::mcp::detail::clip(std::string(in_at(ptr, len)), static_cast<std::size_t>(cap < 0 ? 0 : cap)));
    return 0;
}

__attribute__((export_name("gm_output_digest")))
std::int32_t gm_output_digest(const char* ptr, std::int32_t len, std::int32_t failed) {
    set_out(gm::json::dump(gm::mcp::detail::output_digest(std::string(in_at(ptr, len)), failed != 0)));
    return 0;
}

__attribute__((export_name("gm_core_version")))
std::int32_t gm_core_version() {
    return 2;
}

}
