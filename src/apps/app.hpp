#pragma once

#include <vector>
#include <memory>

#include "../device/device.hpp"
#include "../render/render.hpp"

namespace nugie {
    class Application {
    public:
        Application();
        void run();

    private:
        std::unique_ptr<Device> device;
        std::vector<std::shared_ptr<Renderer>> renderers;
    };
}