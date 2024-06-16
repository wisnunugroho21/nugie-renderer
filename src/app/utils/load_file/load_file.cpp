#include "load_file.hpp"

#include <stdexcept>
#include <sys/stat.h>

#ifdef _WIN32

#include <cstring>

#endif

namespace NugieApp {
#ifdef _WIN32

    char *ReadBinaryFile(const char *pFilename, int *size) {
        FILE *f = nullptr;

        errno_t err = fopen_s(&f, pFilename, "rb");

        if (!f) {
            char buf[256] = {0};
            strerror_s(buf, sizeof(buf), err);
            throw std::runtime_error("Error opening file");
            exit(0);
        }

        struct stat stat_buf{};
        int error = stat(pFilename, &stat_buf);

        if (error) {
            char buf[256] = {0};
            strerror_s(buf, sizeof(buf), err);
            throw std::runtime_error("Error getting file");
            return nullptr;
        }

        *size = stat_buf.st_size;

        char *p = (char *) malloc(*size);
        assert(p);

        size_t bytes_read = fread(p, 1, *size, f);

        if (bytes_read != *size) {
            char buf[256] = {0};
            strerror_s(buf, sizeof(buf), err);
            throw std::runtime_error("Read file error");
            exit(0);
        }

        fclose(f);

        return p;
    }

#else
    char* ReadBinaryFile(const char* pFilename, int* size)
    {
        FILE* f = fopen(pFilename, "rb");

        if (!f) {
            throw std::runtime_error("Error opening file");
            exit(0);
        }

        struct stat stat_buf;
        int error = stat(pFilename, &stat_buf);

        if (error) {
            throw std::runtime_error("Error getting file");
            return NULL;
        }

        *size = stat_buf.st_size;

        char* p = (char*)malloc(*size);
        assert(p);

        size_t bytes_read = fread(p, 1, *size, f);

        if (bytes_read != *size) {
            throw std::runtime_error("Read file error");
            exit(0);
        }

        fclose(f);

        return p;
    }
#endif
}