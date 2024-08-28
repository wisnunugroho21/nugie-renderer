#pragma once

#include <functional>

#include "device.hpp"

namespace NugieVulkan {
    template <class Func>
	Func GetProcedure(Device *device, const char* name) {
		const auto func = reinterpret_cast<Func>(vkGetDeviceProcAddr(device->getLogicalDevice(), name));
		if (func == nullptr) {
			throw std::runtime_error(std::string("failed to get address of '") + name + "'");
		}

		return func;
	}

    class DeviceProcedures {
    public:
        DeviceProcedures(Device *device);

        const std::function<void(
            VkCommandBuffer commandBuffer,
            uint32_t groupCountX,
            uint32_t groupCountY,
            uint32_t groupCountZ)>
        vkCmdDrawMeshTasksEXT;

    private:
        Device *device;
    };

    
}