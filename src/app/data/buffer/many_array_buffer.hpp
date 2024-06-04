#pragma once

#include "../../../vulkan/device/device.hpp"
#include "../../../vulkan/buffer/buffer.hpp"
#include "../../../vulkan/command/command_buffer.hpp"

#include <vector>
#include <memory>

namespace NugieApp {
	template <typename T>
	class ManyArrayBuffer {
		public:
			ManyArrayBuffer(NugieVulkan::Device* device, VkBufferUsageFlags usageFlags, uint32_t instanceCount = 1000000u, bool isAlsoCreateStaging = true);
			~ManyArrayBuffer();
			
			NugieVulkan::Buffer* getBuffer(uint32_t index) const { return this->buffers[index]; }
			std::vector<VkDescriptorBufferInfo> getInfo() const;
			uint32_t size() const { return this->count; }

			void replace(NugieVulkan::CommandBuffer* commandBuffer, std::vector<T> objects);
			void initializeValue(NugieVulkan::CommandBuffer* commandBuffer, uint32_t value = 0u);
			
		private:
			NugieVulkan::Device* device = nullptr;

			bool isAlsoCreateStaging;
			uint32_t count;

			std::vector<NugieVulkan::Buffer*> stagingBuffers;
			std::vector<NugieVulkan::Buffer*> buffers;

			void createBuffers(VkBufferUsageFlags usageFlags, uint32_t instanceCount);
	};

	template <typename T>
	ManyArrayBuffer<T>::ManyArrayBuffer(NugieVulkan::Device* device, VkBufferUsageFlags usageFlags, uint32_t instanceCount, bool isAlsoCreateStaging) : device{device}, isAlsoCreateStaging{isAlsoCreateStaging} {
		this->createBuffers(usageFlags, instanceCount);
	}

	template <typename T>
	ManyArrayBuffer<T>::~ManyArrayBuffer() {
		for (auto &&buffer : this->stagingBuffers) {
			if (buffer != nullptr) delete buffer;
		}

		for (auto &&buffer : this->buffers) {
			if (buffer != nullptr) delete buffer;
		}
	}

	template <typename T>
	std::vector<VkDescriptorBufferInfo> ManyArrayBuffer<T>::getInfo() const {
		std::vector<VkDescriptorBufferInfo> buffersInfo{};
		
		for (int i = 0; i < this->buffers.size(); i++) {
			buffersInfo.emplace_back(this->buffers[i]->descriptorInfo());
		}

		return buffersInfo;
	}

	template <typename T>
	void ManyArrayBuffer<T>::createBuffers(VkBufferUsageFlags usageFlags, uint32_t instanceCount) {
		uint32_t instanceSize = static_cast<uint32_t>(sizeof(T));

		if (!(usageFlags & (1 << VK_BUFFER_USAGE_TRANSFER_DST_BIT)) && this->isAlsoCreateStaging) {
			usageFlags |= VK_BUFFER_USAGE_TRANSFER_DST_BIT;
		}

		for (uint32_t i = 0; i < NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT; i++) {
			this->buffers.emplace_back(new NugieVulkan::Buffer(
				this->device,
				instanceSize,
				instanceCount,
				usageFlags,
				VMA_MEMORY_USAGE_AUTO,
				VMA_ALLOCATION_CREATE_DEDICATED_MEMORY_BIT
			));

			if (this->isAlsoCreateStaging) {
				this->stagingBuffers.emplace_back(new NugieVulkan::Buffer(
					this->device,
					instanceSize,
					instanceCount,
					VK_BUFFER_USAGE_TRANSFER_SRC_BIT,
					VMA_MEMORY_USAGE_AUTO,
					VMA_ALLOCATION_CREATE_HOST_ACCESS_SEQUENTIAL_WRITE_BIT | VMA_ALLOCATION_CREATE_MAPPED_BIT
				));

				this->stagingBuffers[i]->map();
			}
		}
	}

	template <typename T>
	void ManyArrayBuffer<T>::replace(NugieVulkan::CommandBuffer* commandBuffer, std::vector<T> objects) {
		assert(this->isAlsoCreateStaging && "you need to create staging for this buffer before replace whole data");

		this->count = static_cast<uint32_t>(objects.size());
		auto bufferSize = static_cast<VkDeviceSize>(sizeof(T)) * static_cast<VkDeviceSize>(this->count);

		for (size_t i = 0; i < this->buffers.size(); i++) {
			this->stagingBuffers[i]->writeToBuffer((void *) objects.data(), bufferSize);
			this->buffers[i]->copyFromAnotherBuffer(commandBuffer, this->stagingBuffers[i], bufferSize);
		}
	}

	template <typename T>
	void ManyArrayBuffer<T>::initializeValue(NugieVulkan::CommandBuffer* commandBuffer, uint32_t value) {
		for (size_t i = 0; i < this->buffers.size(); i++) {
			this->buffers[i]->fillBuffer(commandBuffer, value);
		}
	}
} // namespace NugieApp
