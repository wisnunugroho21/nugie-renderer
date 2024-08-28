#pragma once

#include <string>
#include <cstdint>

namespace NugieDisplay {
    enum class KeyMap {
        KEY_A,
        KEY_D,
        KEY_W,
        KEY_S,
        KEY_E,
        KEY_Q,
        KEY_LEFT,
        KEY_RIGHT,
        KEY_UP,
        KEY_DOWN,
    };

    class Window {
    public:
        uint32_t getWidth() const { return this->width; }

        uint32_t getHeight() const { return this->height; }

        bool wasResized() const { return this->frameBufferResized; }

        virtual void setAppTitle(std::string title) = 0;

        virtual void resetResizedFlag() = 0;

        virtual bool shouldClose() = 0;

        virtual bool isKeyPressed(KeyMap keyMap) = 0;

        virtual bool isKeyReleased(KeyMap keyMap) = 0;

        virtual void pollEvents() = 0;

    protected:
        bool frameBufferResized = false;

        uint32_t width, height;
        std::string name;
    };
}
