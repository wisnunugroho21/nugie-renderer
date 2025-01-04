#include "app.hpp"

#include "../render/render.hpp"
#include "../render/basic/basic_render.hpp"

namespace nugie {
    Application::Application() {
        this->device = std::make_unique<Device>();

        this->renderers.emplace_back(std::make_shared<BasicRenderer>());
    }

    void Application::run() {
        this->device->initialize("Nugie Renderer", 640, 480);

        for (auto &&renderer : this->renderers) {
            renderer->initialize(this->device.get());
        }

        while (this->device->isRunning()) {
            this->device->poolEvents();

            for (auto &&renderer : this->renderers) {
                renderer->render(this->device.get());                
            }
        }

        for (auto &&renderer : this->renderers) {
            renderer->destroy(this->device.get());
        }
    }
}