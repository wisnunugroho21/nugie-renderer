#include "spot_light_model.hpp"

#include <cstring>
#include <iostream>
#include <unordered_map>

#define GLM_ENABLE_EXPERIMENTAL
#include <glm/gtx/hash.hpp>

namespace NugieApp {
	SpotLightModel::SpotLightModel(NugieVulkan::Device* device) : device{device} {
		this->createBuffers();
	}

	SpotLightModel::~SpotLightModel() {
		if (this->stagingBuffer != nullptr) delete this->stagingBuffer;
		if (this->buffer != nullptr) delete this->buffer;
	}

	void SpotLightModel::createBuffers() {
		uint32_t instanceSize = static_cast<uint32_t>(sizeof(SpotLight));

		this->stagingBuffer = new NugieVulkan::Buffer(
			this->device,
			instanceSize,
			1000000,
			VK_BUFFER_USAGE_TRANSFER_SRC_BIT,
			VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT | VK_MEMORY_PROPERTY_HOST_COHERENT_BIT
		);

		this->buffer = new NugieVulkan::Buffer(
			this->device,
			instanceSize,
			1000000,
			VK_BUFFER_USAGE_STORAGE_BUFFER_BIT | VK_BUFFER_USAGE_TRANSFER_DST_BIT,
			VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT
		);
	}

	void SpotLightModel::update(NugieVulkan::CommandBuffer* commandBuffer, std::vector<SpotLight> objects) {
		auto bufferSize = static_cast<VkDeviceSize>(sizeof(SpotLight)) * static_cast<VkDeviceSize>(objects.size());

		this->stagingBuffer->map();
		this->stagingBuffer->writeToBuffer((void *) objects.data(), bufferSize);
		
		this->buffer->copyFromAnotherBuffer(commandBuffer, this->stagingBuffer, bufferSize);
	} 
} // namespace nugi

